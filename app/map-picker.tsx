"use client";

import { Check, LoaderCircle, LocateFixed, Map } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
type MapsAutocompleteElement = HTMLElement & { includedRegionCodes?: string[] };
type MapsLegacyAutocomplete = {
  addListener(event: string, handler: () => void): void;
  getPlace(): { geometry?: { location?: MapsPoint }; formatted_address?: string; name?: string };
};

type MapsLibraries = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Marker: new (options: Record<string, unknown>) => MapsMarker;
  Geocoder: new () => MapsGeocoder;
  /** The current Places search box. Absent on very old projects. */
  PlaceAutocompleteElement: (new (options?: Record<string, unknown>) => MapsAutocompleteElement) | null;
  /** The retired one, kept only for projects created before March 2025. */
  LegacyAutocomplete: (new (input: HTMLInputElement, options?: Record<string, unknown>) => MapsLegacyAutocomplete) | null;
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
    PlaceAutocompleteElement?: MapsLibraries["PlaceAutocompleteElement"];
    Autocomplete?: MapsLibraries["LegacyAutocomplete"];
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
        PlaceAutocompleteElement: namespace.places?.PlaceAutocompleteElement ?? null,
        LegacyAutocomplete: namespace.places?.Autocomplete ?? null,
      });
    };
    const globals = window as unknown as Record<string, unknown> & { google?: { maps?: MapsNamespace } };
    if (globals.google?.maps?.Map) return settle(globals.google.maps);

    const timer = window.setTimeout(() => settle(null), LOAD_TIMEOUT_MS);
    globals[READY_CALLBACK] = () => {
      window.clearTimeout(timer);
      settle(globals.google?.maps ?? null);
    };
    const existing = document.querySelector("script[data-healthfield-maps]");
    if (existing) return;
    const script = document.createElement("script");
    // marker and places are requested up front so the callback guarantees all of them;
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

/**
 * Pin-a-location control used at checkout and when saving a branch address.
 *
 * A customer is never asked for coordinates. They either search for where they are and
 * pick from Google's suggestions, tap the map, or hand over their device location — and
 * any of the three produces the precise point the delivery fee is measured from.
 */
export function MapPicker({
  value,
  onChange,
  height = 260,
  searchPlaceholder = "Search for your estate, road or landmark",
}: {
  value: PinnedLocation | null;
  onChange: (location: PinnedLocation | null) => void;
  height?: number;
  searchPlaceholder?: string;
}) {
  const apiKey = googleMapsApiKey();
  const mapElement = useRef<HTMLDivElement>(null);
  const searchHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markerRef = useRef<MapsMarker | null>(null);
  const geocoderRef = useRef<MapsGeocoder | null>(null);
  // The element the map was built on. React mounts effects twice in development, and
  // the map must not be constructed a second time over the same node.
  const builtOn = useRef<HTMLElement | null>(null);
  const libraries = useRef<MapsLibraries | null>(null);
  // Kept in a ref so the map listeners, which are registered once, always call the
  // current handler rather than the one captured on first render.
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const [mapsFailed, setMapsFailed] = useState(!apiKey);
  const [mapsAvailable, setMapsAvailable] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [searchReady, setSearchReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hint, setHint] = useState("Search for your area, or use your current location.");

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

  const attachSearch = useCallback((maps: MapsLibraries, host: HTMLDivElement) => {
    if (host.childElementCount) return true;
    // The current element first. A key issued today has no access to the retired
    // Autocomplete, so relying on that alone would leave production with no search.
    if (maps.PlaceAutocompleteElement) {
      const element = new maps.PlaceAutocompleteElement({ includedRegionCodes: ["ke"] });
      element.className = "map-picker-search";
      element.setAttribute("placeholder", searchPlaceholder);
      host.append(element);
      const select = async (event: Event) => {
        const prediction = (event as Event & { placePrediction?: { toPlace(): MapsPlace } }).placePrediction;
        const place = prediction?.toPlace();
        if (!place) return;
        await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] }).catch(() => null);
        const point = place.location;
        if (!point) return;
        mapRef.current?.setZoom(16);
        void publish(point.lat(), point.lng(), place.formattedAddress ?? place.displayName ?? null);
      };
      // The event was renamed; both are registered so either library build works.
      element.addEventListener("gmp-select", (event) => void select(event));
      element.addEventListener("gmp-placeselect", (event) => void select(event));
      return true;
    }
    if (maps.LegacyAutocomplete) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "map-picker-search";
      input.placeholder = searchPlaceholder;
      input.setAttribute("aria-label", "Search for your location");
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") event.preventDefault(); });
      host.append(input);
      const autocomplete = new maps.LegacyAutocomplete(input, {
        fields: ["geometry", "formatted_address", "name"],
        componentRestrictions: { country: ["ke"] },
      });
      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        const point = place.geometry?.location;
        if (!point) return;
        mapRef.current?.setZoom(16);
        void publish(point.lat(), point.lng(), place.formatted_address ?? place.name ?? null);
      });
      return true;
    }
    return false;
  }, [publish, searchPlaceholder]);

  // The search box is set up on mount, but no map is drawn. Google bills a Dynamic Map
  // load every time one is instantiated, and most customers find their address from the
  // suggestions alone — so the map is only built for the few who ask to see it.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    void loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled) return;
      if (!maps) { setMapsFailed(true); return; }
      libraries.current = maps;
      geocoderRef.current = new maps.Geocoder();
      if (searchHost.current && attachSearch(maps, searchHost.current)) setSearchReady(true);
      setMapsAvailable(true);
    });
    return () => { cancelled = true; };
  }, [apiKey, attachSearch]);

  // Drawn on request only. Guarded by the element it was built on, because React mounts
  // effects twice in development and a second map over the same node bills twice.
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
  // error the customer has to clear — the hint simply points back at the search box.
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
        setHint("Search for your area above to set your location.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  // Nothing here ever shows the customer a fault. A map that will not load, a declined
  // permission or a project without Places all just leave fewer ways to set the pin —
  // the remaining ones still work, and the panel reads the same either way.
  return (
    <div className="map-picker">
      <div className="map-picker-search-row">
        {/* The frame is always on screen. Google's element is appended into it once
            Places has loaded; until then — and on a project without Places at all —
            the placeholder below holds the space so the field is never missing. */}
        <div className="map-picker-search-host">
          <div ref={searchHost} hidden={!searchReady} />
          {!searchReady ? (
            <input
              type="text"
              className="map-picker-search"
              placeholder={searchPlaceholder}
              aria-label="Search for your location"
              readOnly
            />
          ) : null}
        </div>
        {mapsAvailable && !mapOpen ? (
          <button type="button" className="map-picker-open" onClick={() => setMapOpen(true)}>
            <Map /> Open map
          </button>
        ) : null}
      </div>
      {/* Mounted only once the customer asks for it: each map costs a billed load. */}
      {mapOpen ? (
        <div
          className="map-picker-canvas"
          style={{ height }}
          ref={mapElement}
          aria-label="Delivery location map"
          role="application"
          hidden={mapsFailed}
        />
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
        ) : (
          <span className="map-picker-hint">{hint}</span>
        )}
      </div>
    </div>
  );
}
