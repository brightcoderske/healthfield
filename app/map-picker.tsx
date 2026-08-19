"use client";

import { Check, LoaderCircle, LocateFixed, Map, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type PinnedLocation = {
  latitude: number;
  longitude: number;
  /** The address Google gave for this point, shown back to the customer. */
  address: string | null;
};

/**
 * Only the slice of the Google Maps JS API this component touches.
 *
 * Declared locally rather than pulling in @types/google.maps: the surface used here is
 * a handful of calls wide and the package would otherwise be a dependency of the whole
 * app.
 */
type LatLngLiteral = { lat: number; lng: number };
type MapsPoint = { lat(): number; lng(): number };
type MapsMouseEvent = { latLng?: MapsPoint };
type MapsMap = {
  setCenter(position: LatLngLiteral): void;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (payload: MapsMouseEvent) => void): void;
};
type MapsMarker = {
  setPosition(position: LatLngLiteral): void;
  addListener(event: string, handler: (payload: MapsMouseEvent) => void): void;
};
type MapsGeocoder = {
  geocode(request: { location: LatLngLiteral }): Promise<{ results: Array<{ formatted_address?: string }> }>;
};
type MapsPlace = {
  fetchFields(request: { fields: string[] }): Promise<unknown>;
  location?: MapsPoint | null;
  formattedAddress?: string | null;
  displayName?: string | null;
};
type PlacePrediction = {
  placeId: string;
  text: { toString(): string };
  mainText?: { toString(): string } | null;
  secondaryText?: { toString(): string } | null;
  toPlace(): MapsPlace;
};
type MapsLibraries = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Marker: new (options: Record<string, unknown>) => MapsMarker;
  Geocoder: new () => MapsGeocoder;
  /** Data-level autocomplete. Absent only on a project without Places (New). */
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{
      suggestions: Array<{ placePrediction: PlacePrediction | null }>;
    }>;
  } | null;
  AutocompleteSessionToken: (new () => object) | null;
};

// Nairobi, used only as the initial camera position before anything is pinned.
const DEFAULT_CENTRE = { lat: -1.286389, lng: 36.817223 };

let mapsLoader: Promise<MapsLibraries | null> | null = null;

// Google calls this by name once the API and its libraries are ready.
const READY_CALLBACK = "__healthfieldMapsReady";
// A pharmacy customer is often on a slow mobile connection. Past this, the map is
// treated as unavailable and the location button carries the flow instead of the page
// sitting on a dead panel indefinitely.
const LOAD_TIMEOUT_MS = 20_000;

type MapsNamespace = {
  Map?: MapsLibraries["Map"];
  Marker?: MapsLibraries["Marker"];
  Geocoder?: MapsLibraries["Geocoder"];
  places?: {
    AutocompleteSuggestion?: MapsLibraries["AutocompleteSuggestion"];
    AutocompleteSessionToken?: MapsLibraries["AutocompleteSessionToken"];
  };
};

/**
 * Loads the Maps JS API and resolves the constructors this component needs.
 *
 * Readiness comes from Google's own `callback` parameter rather than the script tag's
 * load event. The script fires `load` before the API has finished bootstrapping, so
 * reading `google.maps.Map` at that point yields undefined and the map silently never
 * appears — the callback is the only signal that the libraries are actually usable.
 */
function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise<MapsLibraries | null>((resolve) => {
    const settle = (namespace: MapsNamespace | null) => {
      if (!namespace?.Map || !namespace.Marker || !namespace.Geocoder) return resolve(null);
      resolve({
        Map: namespace.Map,
        Marker: namespace.Marker,
        Geocoder: namespace.Geocoder,
        AutocompleteSuggestion: namespace.places?.AutocompleteSuggestion ?? null,
        AutocompleteSessionToken: namespace.places?.AutocompleteSessionToken ?? null,
      });
    };
    const globals = window as unknown as Record<string, unknown> & { google?: { maps?: MapsNamespace } };
    if (globals.google?.maps?.Map) return settle(globals.google.maps);

    const timer = window.setTimeout(() => settle(null), LOAD_TIMEOUT_MS);
    globals[READY_CALLBACK] = () => {
      window.clearTimeout(timer);
      settle(globals.google?.maps ?? null);
    };
    if (document.querySelector("script[data-healthfield-maps]")) return;
    const script = document.createElement("script");
    // places and marker are requested up front so the callback guarantees all of them;
    // pulling them in later would reintroduce the readiness problem it solves.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,marker&callback=${READY_CALLBACK}&loading=async&v=weekly`;
    script.async = true;
    script.dataset.healthfieldMaps = "true";
    // A blocked or failed load is not fatal: the location button still works.
    script.onerror = () => { window.clearTimeout(timer); settle(null); };
    document.head.append(script);
  }).then((libraries) => {
    // Cleared on failure so a later mount can try again rather than inheriting a
    // permanently broken promise.
    if (!libraries) mapsLoader = null;
    return libraries;
  });
  return mapsLoader;
}

export function googleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
}

type Suggestion = { placeId: string; primary: string; secondary: string; prediction: PlacePrediction };

/**
 * Pin-a-location control used at checkout and when saving a branch address.
 *
 * The search box is an ordinary input driving the Places Data API, not Google's
 * `PlaceAutocompleteElement`. That element renders into a closed shadow root, which
 * makes it unstylable, unmeasurable, and — on a narrow phone — effectively untappable.
 * Owning the input means the field is a plain text box on every device, and the
 * suggestion list is ours to lay out.
 *
 * A customer is never asked for coordinates. They search and pick, tap the map, or hand
 * over their device location; each produces the point the delivery fee is measured from.
 */
export function MapPicker({
  value,
  onChange,
  height = 240,
  searchPlaceholder = "Search your estate, road or landmark",
}: {
  value: PinnedLocation | null;
  onChange: (location: PinnedLocation | null) => void;
  height?: number;
  searchPlaceholder?: string;
}) {
  const apiKey = googleMapsApiKey();
  const listboxId = useId();
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markerRef = useRef<MapsMarker | null>(null);
  const geocoderRef = useRef<MapsGeocoder | null>(null);
  const libraries = useRef<MapsLibraries | null>(null);
  // One token per search-then-pick cycle: Google bills the whole cycle as a single
  // session rather than per keystroke, so it is renewed only after a selection.
  const sessionToken = useRef<object | null>(null);
  // The element the map was built on. React mounts effects twice in development, and
  // building a second map over the same node bills twice.
  const builtOn = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);
  // Kept in a ref so the map listeners, registered once, always call the current
  // handler rather than the one captured on first render.
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchBroken, setSearchBroken] = useState(false);
  const [mapsAvailable, setMapsAvailable] = useState(false);
  // The load has finished, one way or the other. Distinguishes "still loading" from
  // "genuinely unavailable", which decides whether the search box reports a fault.
  const [mapsSettled, setMapsSettled] = useState(!googleMapsApiKey());
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hint, setHint] = useState("");

  const publish = useCallback(async (latitude: number, longitude: number, address?: string | null) => {
    let resolved = address ?? null;
    if (!resolved && geocoderRef.current) {
      resolved = await geocoderRef.current
        .geocode({ location: { lat: latitude, lng: longitude } })
        .then((result) => result.results[0]?.formatted_address ?? null)
        .catch(() => null);
    }
    markerRef.current?.setPosition({ lat: latitude, lng: longitude });
    mapRef.current?.setCenter({ lat: latitude, lng: longitude });
    changeRef.current({ latitude, longitude, address: resolved });
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    void loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled) return;
      setMapsSettled(true);
      if (!maps) { setSearchBroken(true); return; }
      libraries.current = maps;
      geocoderRef.current = new maps.Geocoder();
      setMapsAvailable(true);
      if (!maps.AutocompleteSuggestion) setSearchBroken(true);
    });
    return () => { cancelled = true; };
  }, [apiKey]);

  // Predictions are debounced so a fast typist is billed for one session, not ten.
  useEffect(() => {
    const text = query.trim();
    // Below three characters there is nothing worth a billed request; the field is
    // cleared by the change handler rather than here, so this effect only ever fetches.
    if (text.length < 3) return;
    const id = (requestId.current += 1);
    const timer = window.setTimeout(async () => {
      // Resolved inside the timer, not above it: bailing out early left the spinner
      // running forever whenever Places was unavailable, because the change handler had
      // already switched it on and nothing was left to switch it off.
      const maps = libraries.current;
      const autocomplete = maps?.AutocompleteSuggestion;
      if (!maps || !autocomplete) {
        if (id !== requestId.current) return;
        setSearching(false);
        // Only a settled load counts as broken; still loading just means try again on
        // the next keystroke, which the mapsAvailable dependency below takes care of.
        if (mapsSettled) setSearchBroken(true);
        return;
      }
      if (maps.AutocompleteSessionToken && !sessionToken.current) sessionToken.current = new maps.AutocompleteSessionToken();
      try {
        const response = await autocomplete.fetchAutocompleteSuggestions({
          input: text,
          sessionToken: sessionToken.current ?? undefined,
          includedRegionCodes: ["ke"],
        });
        if (id !== requestId.current) return;
        setSuggestions(
          response.suggestions.flatMap((entry) => {
            const prediction = entry.placePrediction;
            if (!prediction) return [];
            return [{
              placeId: prediction.placeId,
              primary: prediction.mainText?.toString() ?? prediction.text.toString(),
              secondary: prediction.secondaryText?.toString() ?? "",
              prediction,
            }];
          }),
        );
      } catch {
        if (id !== requestId.current) return;
        // Almost always the key's referrer allowlist rather than anything transient, so
        // the customer is pointed at the controls that still work instead of a retry.
        setSearchBroken(true);
        setSuggestions([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // mapsSettled re-runs the search once the API finishes loading mid-typing.
  }, [query, mapsSettled]);

  async function choose(suggestion: Suggestion) {
    setQuery(suggestion.primary);
    setSuggestions([]);
    const place = suggestion.prediction.toPlace();
    await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] }).catch(() => null);
    // The session closes with the selection; the next search starts a fresh one.
    sessionToken.current = null;
    const point = place.location;
    if (!point) return;
    mapRef.current?.setZoom(16);
    const label = place.formattedAddress ?? suggestion.secondary
      ? [suggestion.primary, suggestion.secondary].filter(Boolean).join(", ")
      : suggestion.primary;
    void publish(point.lat(), point.lng(), place.formattedAddress ?? label);
  }

  // Drawn on request only, so a customer who found their address by searching never
  // loads a billed map at all.
  useEffect(() => {
    const maps = libraries.current;
    const host = mapElement.current;
    if (!mapOpen || !maps || !host || builtOn.current === host) return;
    builtOn.current = host;
    const centre = value ? { lat: value.latitude, lng: value.longitude } : DEFAULT_CENTRE;
    const map = new maps.Map(host, {
      center: centre,
      zoom: value ? 16 : 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    const marker = new maps.Marker({ map, position: centre, draggable: true });
    mapRef.current = map;
    markerRef.current = marker;
    map.addListener("click", (event) => {
      const point = event.latLng;
      if (point) void publish(point.lat(), point.lng());
    });
    marker.addListener("dragend", (event) => {
      const point = event.latLng;
      if (point) void publish(point.lat(), point.lng());
    });
    setHint("Tap the map or drag the pin to your exact door.");
    // value is the starting centre only; re-centring is handled imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapOpen, publish]);

  // Declining location access is a normal choice, not a fault, so it never produces an
  // error the customer has to clear — the hint points back at what still works.
  function useMyLocation() {
    if (!navigator.geolocation) { setHint("Search for your area above to set your location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        void publish(position.coords.latitude, position.coords.longitude);
      },
      () => {
        setLocating(false);
        setHint("Search for your area above, or open the map to drop a pin.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  return (
    <div className="map-picker">
      <div className="map-picker-search-row">
        <div className="map-picker-field">
          <Search />
          <input
            type="text"
            className="map-picker-input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              const searchable = next.trim().length >= 3;
              setSearching(searchable);
              if (!searchable) setSuggestions([]);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
            autoComplete="off"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
          />
          {searching ? <LoaderCircle className="spin" /> : null}
          {suggestions.length ? (
            <ul className="map-picker-suggestions" id={listboxId} role="listbox">
              {suggestions.map((suggestion) => (
                <li key={suggestion.placeId}>
                  {/* onMouseDown, not onClick: blurring the input first would close the
                      list before the tap resolves. */}
                  <button type="button" role="option" aria-selected="false" onMouseDown={(event) => { event.preventDefault(); void choose(suggestion); }}>
                    <strong>{suggestion.primary}</strong>
                    {suggestion.secondary ? <small>{suggestion.secondary}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {mapsAvailable && !mapOpen ? (
          <button type="button" className="map-picker-open" onClick={() => setMapOpen(true)}>
            <Map /> Open map
          </button>
        ) : null}
      </div>

      {mapOpen ? (
        <div className="map-picker-canvas" style={{ height }} ref={mapElement} aria-label="Delivery location map" role="application" />
      ) : null}

      <div className="map-picker-actions">
        <button type="button" onClick={useMyLocation} disabled={locating}>
          {locating ? <LoaderCircle className="spin" /> : <LocateFixed />}
          {locating ? "Getting your location…" : "Use my current location"}
        </button>
        {value ? (
          <span className="map-picker-pin">
            <Check /> {value.address || `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`}
          </span>
        ) : null}
      </div>

      {searchBroken && !value ? (
        <p className="map-picker-hint">
          Address search is unavailable right now — use your current location, or open the
          map and drop a pin.
        </p>
      ) : hint && !value ? (
        <p className="map-picker-hint">{hint}</p>
      ) : null}
    </div>
  );
}
