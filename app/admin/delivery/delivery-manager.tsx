"use client";

import {
  ArrowDown,
  ArrowUp,
  Building2,
  MapPin,
  Plus,
  Route,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { MapPicker, type PinnedLocation } from "../../map-picker";

export type DeliveryBandRow = {
  id: number;
  label: string;
  minKm: number;
  maxKm: number;
  fee: number;
  freeAboveSubtotal: number | null;
  freeDeliveryEligible: boolean;
  courier: string | null;
  displayOrder: number;
  isActive: boolean;
};

export type DeliveryRules = {
  enabled: boolean;
  freeDeliveryThreshold: number | null;
  maxRadiusKm: number | null;
  outsideCoverage: "BLOCK" | "CUSTOM_FEE";
  outsideFee: number | null;
  detourFactor: number;
  useRoadDistance: boolean;
  fallbackFee: number;
};

export type PinnedBranch = {
  id: number;
  name: string;
  code: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  isActive: boolean;
};

type Preview = {
  available: boolean;
  fee: number;
  free: boolean;
  distanceKm: number;
  message: string;
  bandLabel: string | null;
  courier: string | null;
  branchName: string | null;
  routed: boolean;
  fallbackReason: string | null;
};

const money = (value: number) => `KSh ${value.toLocaleString()}`;
// A zero-fee band is a deliberate choice — "everything within 3 km is free" — so it
// reads as free rather than as a price of nothing.
const fee = (value: number) => (value === 0 ? "Free" : money(value));

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function DeliveryManager({
  initialRules,
  initialBands,
  branches,
  googleConfigured,
}: {
  initialRules: DeliveryRules;
  initialBands: DeliveryBandRow[];
  branches: PinnedBranch[];
  googleConfigured: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [bands, setBands] = useState(initialBands);
  const [editing, setEditing] = useState<DeliveryBandRow | "new" | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [busyBand, setBusyBand] = useState<number | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewPin, setPreviewPin] = useState<PinnedLocation | null>(null);
  const [previewSubtotal, setPreviewSubtotal] = useState("1500");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const unpinned = branches.filter((branch) => branch.isActive && (!branch.latitude || !branch.longitude));
  const activeBands = bands.filter((band) => band.isActive);
  const coverage = useMemo(
    () => activeBands.reduce((furthest, band) => Math.max(furthest, band.maxKm), 0),
    [activeBands],
  );
  const gaps = useMemo(() => {
    const sorted = activeBands.slice().sort((left, right) => left.minKm - right.minKm);
    const found: string[] = [];
    if (sorted.length && sorted[0].minKm > 0) found.push(`0-${sorted[0].minKm} km`);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].minKm > sorted[index - 1].maxKm) {
        found.push(`${sorted[index - 1].maxKm}-${sorted[index].minKm} km`);
      }
    }
    return found;
  }, [activeBands]);

  async function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outsideCoverage = String(form.get("outsideCoverage") || "BLOCK") as DeliveryRules["outsideCoverage"];
    const payload = {
      deliveryPricingEnabled: form.get("enabled") === "on",
      freeDeliveryThreshold: numberOrNull(form.get("freeDeliveryThreshold")),
      deliveryMaxRadiusKm: numberOrNull(form.get("maxRadiusKm")),
      deliveryOutsideCoverage: outsideCoverage,
      deliveryOutsideFee: numberOrNull(form.get("outsideFee")),
      deliveryDetourFactor: Number(form.get("detourFactor") || 1.3),
      deliveryUseRoadDistance: form.get("useRoadDistance") === "on",
      deliveryFallbackFee: Number(form.get("fallbackFee") || 0),
    };
    setSavingRules(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/delivery/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The delivery rules could not be saved.");
      setRules({
        enabled: payload.deliveryPricingEnabled,
        freeDeliveryThreshold: payload.freeDeliveryThreshold,
        maxRadiusKm: payload.deliveryMaxRadiusKm,
        outsideCoverage: payload.deliveryOutsideCoverage,
        outsideFee: payload.deliveryOutsideFee,
        detourFactor: payload.deliveryDetourFactor,
        useRoadDistance: payload.deliveryUseRoadDistance,
        fallbackFee: payload.deliveryFallbackFee,
      });
      setNotice("Delivery rules saved. New checkouts price against them immediately.");
    } finally {
      setSavingRules(false);
    }
  }

  async function saveBand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      label: String(form.get("label") || "").trim(),
      minKm: Number(form.get("minKm") || 0),
      maxKm: Number(form.get("maxKm") || 0),
      fee: Number(form.get("fee") || 0),
      freeAboveSubtotal: numberOrNull(form.get("freeAboveSubtotal")),
      freeDeliveryEligible: form.get("freeDeliveryEligible") === "on",
      courier: String(form.get("courier") || "").trim() || null,
      isActive: form.get("isActive") === "on",
    };
    const isNew = editing === "new";
    setBusyBand(isNew ? "new" : editing.id);
    setError("");
    try {
      const response = await fetch(isNew ? "/api/delivery/bands" : `/api/delivery/bands/${editing.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The band could not be saved.");
      if (isNew) {
        const displayOrder = bands.reduce((highest, band) => Math.max(highest, band.displayOrder), 0) + 1;
        setBands((current) => [...current, { ...payload, id: data.id, displayOrder }]);
      } else {
        setBands((current) => current.map((band) => (band.id === editing.id ? { ...band, ...payload } : band)));
      }
      setEditing(null);
    } finally {
      setBusyBand(null);
    }
  }

  async function toggleBand(band: DeliveryBandRow) {
    setBusyBand(band.id);
    setError("");
    try {
      const response = await fetch(`/api/delivery/bands/${band.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !band.isActive }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The band could not be updated.");
      setBands((current) => current.map((row) => (row.id === band.id ? { ...row, isActive: !row.isActive } : row)));
    } finally {
      setBusyBand(null);
    }
  }

  async function removeBand(band: DeliveryBandRow) {
    setBusyBand(band.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/delivery/bands/${band.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The band could not be removed.");
      if (data.deleted) setBands((current) => current.filter((row) => row.id !== band.id));
      else {
        setBands((current) => current.map((row) => (row.id === band.id ? { ...row, isActive: false } : row)));
        setNotice(data.message || "The band was deactivated because it has priced past orders.");
      }
    } finally {
      setBusyBand(null);
    }
  }

  async function move(band: DeliveryBandRow, direction: -1 | 1) {
    const ordered = bands.slice().sort((left, right) => left.displayOrder - right.displayOrder);
    const index = ordered.findIndex((row) => row.id === band.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const resequenced = ordered.map((row, position) => ({ ...row, displayOrder: position + 1 }));
    setBands(resequenced);
    setBusyBand(band.id);
    try {
      const response = await fetch("/api/delivery/bands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: resequenced.map((row) => row.id) }),
      });
      if (!response.ok) setError("The new order could not be saved. Reload to see the stored sequence.");
    } finally {
      setBusyBand(null);
    }
  }

  async function runPreview() {
    if (!previewPin) return;
    setPreviewing(true);
    setError("");
    try {
      const response = await fetch("/api/delivery/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: previewPin.latitude,
          longitude: previewPin.longitude,
          subtotal: Number(previewSubtotal) || 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The preview could not be calculated.");
      setPreview(data as Preview);
    } finally {
      setPreviewing(false);
    }
  }

  const current = editing === "new" ? null : editing;
  const ordered = bands.slice().sort((left, right) => left.displayOrder - right.displayOrder);

  return (
    <main className="compact-admin-page delivery-admin">
      <header>
        <div>
          <Link href="/admin">← Dashboard</Link>
          <h1>Delivery pricing</h1>
          <p>
            Checkout finds the branch that can fulfil the order, measures how far the
            customer pinned themselves, matches a distance band and then applies the
            free-delivery rule.
          </p>
        </div>
        <button onClick={() => setEditing("new")}>
          <Plus /> Add band
        </button>
      </header>

      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}

      {!rules.enabled ? (
        <div className="delivery-warning" role="status">
          <TriangleAlert />
          <span>
            Distance pricing is switched off. Every delivery is charged the flat fallback
            fee of {money(rules.fallbackFee)} until you turn it on below.
          </span>
        </div>
      ) : null}
      {unpinned.length ? (
        <div className="delivery-warning" role="status">
          <TriangleAlert />
          <span>
            {unpinned.map((branch) => branch.name).join(", ")}{" "}
            {unpinned.length === 1 ? "has" : "have"} no saved map location, so{" "}
            {unpinned.length === 1 ? "it cannot" : "they cannot"} be used to measure a
            delivery. <Link href="/admin/stores">Pin {unpinned.length === 1 ? "it" : "them"} on the stores screen</Link>.
          </span>
        </div>
      ) : null}
      {gaps.length ? (
        <div className="delivery-warning" role="status">
          <TriangleAlert />
          <span>
            Nothing covers {gaps.join(", ")}. Customers at those distances are treated as
            outside coverage.
          </span>
        </div>
      ) : null}

      <section className="delivery-bands">
        <h2>Distance bands</h2>
        <div className="compact-table">
          <div className="compact-table-head delivery-band-row">
            <span>Band</span>
            <span>Distance</span>
            <span>Fee</span>
            <span>Free delivery</span>
            <span>Carrier</span>
            <span>Status</span>
            <span>Order</span>
          </div>
          {ordered.map((band, index) => (
            <div className={`compact-table-row delivery-band-row ${busyBand === band.id ? "row-saving" : ""}`} key={band.id}>
              <span>
                <Route />
                <button className="row-link" onClick={() => setEditing(band)}>{band.label}</button>
              </span>
              <span>{band.minKm}-{band.maxKm} km</span>
              <b>{fee(band.fee)}</b>
              <span>
                {band.fee === 0
                  ? "Always free"
                  : band.freeAboveSubtotal !== null
                    ? `Above ${money(band.freeAboveSubtotal)}`
                    : band.freeDeliveryEligible
                      ? rules.freeDeliveryThreshold !== null
                        ? `Above ${money(rules.freeDeliveryThreshold)}`
                        : "No rule set"
                      : "Never"}
              </span>
              <span>{band.courier || "Healthfield rider"}</span>
              <span className={band.isActive ? "status-active" : "status-inactive"}>
                {band.isActive ? "Active" : "Inactive"}
              </span>
              <span className="delivery-band-actions">
                <button type="button" onClick={() => move(band, -1)} disabled={index === 0} aria-label={`Move ${band.label} up`}>
                  <ArrowUp />
                </button>
                <button type="button" onClick={() => move(band, 1)} disabled={index === ordered.length - 1} aria-label={`Move ${band.label} down`}>
                  <ArrowDown />
                </button>
                <button type="button" onClick={() => toggleBand(band)}>
                  {band.isActive ? "Deactivate" : "Activate"}
                </button>
                <button type="button" className="danger" onClick={() => removeBand(band)} aria-label={`Delete ${band.label}`}>
                  <Trash2 />
                </button>
              </span>
            </div>
          ))}
          {!ordered.length ? (
            <p className="compact-table-empty">No bands yet. Add one to start charging by distance.</p>
          ) : null}
        </div>
        {activeBands.length ? (
          <p className="delivery-coverage">Coverage reaches {coverage} km from the fulfilling branch.</p>
        ) : null}
      </section>

      <section className="delivery-rules">
        <h2>Shop-wide rules</h2>
        <form onSubmit={saveRules}>
          <div className="product-form-grid">
            <label className="check-label full">
              <input type="checkbox" name="enabled" defaultChecked={rules.enabled} /> Charge delivery by distance
              <small>When off, every delivery is charged the flat fallback fee below.</small>
            </label>
            <label>
              Free delivery above (KSh)
              <input type="number" name="freeDeliveryThreshold" min="0" step="1" defaultValue={rules.freeDeliveryThreshold ?? ""} />
              <small>Applies to every band that has not opted out. Leave blank for none.</small>
            </label>
            <label>
              Maximum service radius (km)
              <input type="number" name="maxRadiusKm" min="0" step="0.1" defaultValue={rules.maxRadiusKm ?? ""} />
              <small>A hard stop. Beyond it, delivery is refused whatever else is set.</small>
            </label>
            <label>
              Outside the configured bands
              <select name="outsideCoverage" defaultValue={rules.outsideCoverage}>
                <option value="BLOCK">Refuse the order</option>
                <option value="CUSTOM_FEE">Charge a custom fee</option>
              </select>
            </label>
            <label>
              Outside-coverage fee (KSh)
              <input type="number" name="outsideFee" min="0" step="1" defaultValue={rules.outsideFee ?? ""} />
            </label>
            <label className="check-label full">
              <input type="checkbox" name="useRoadDistance" defaultChecked={rules.useRoadDistance} /> Use Google driving distance when available
              <small>
                {googleConfigured
                  ? "GOOGLE_MAPS_API_KEY is configured on the API service, so real road distance is used."
                  : "GOOGLE_MAPS_API_KEY is not set on the API service, so the padded straight-line distance is used."}
              </small>
            </label>
            <label>
              Straight-line padding
              <input type="number" name="detourFactor" min="1" max="3" step="0.05" defaultValue={rules.detourFactor} />
              <small>Multiplier applied when routing is unavailable. 1.3 suits most towns.</small>
            </label>
            <label>
              Flat fallback fee (KSh)
              <input type="number" name="fallbackFee" min="0" step="1" defaultValue={rules.fallbackFee} required />
              <small>Charged when distance pricing is off or no branch has been pinned.</small>
            </label>
          </div>
          <button disabled={savingRules}>{savingRules ? "Saving…" : "Save delivery rules"}</button>
        </form>
      </section>

      <section className="delivery-preview">
        <h2>Test a location</h2>
        <p>Pin anywhere to see exactly what a customer there would be charged right now.</p>
        <MapPicker value={previewPin} onChange={setPreviewPin} height={220} searchPlaceholder="Search for the customer's area" />
        <div className="delivery-preview-controls">
          <label>
            Basket subtotal (KSh)
            <input type="number" min="0" step="1" value={previewSubtotal} onChange={(event) => setPreviewSubtotal(event.target.value)} />
          </label>
          <button type="button" onClick={runPreview} disabled={!previewPin || previewing}>
            {previewing ? "Calculating…" : "Calculate"}
          </button>
        </div>
        {preview ? (
          <div className={`delivery-preview-result ${preview.available ? "" : "unavailable"}`}>
            <strong>{preview.message}</strong>
            <span>
              {preview.available
                ? `${preview.distanceKm} km${preview.bandLabel ? ` · ${preview.bandLabel}` : " · outside every band"}${preview.branchName ? ` · from ${preview.branchName}` : ""}`
                : "No band covers this location."}
            </span>
            {preview.courier ? <span>Carried by {preview.courier}.</span> : null}
            <span className="delivery-preview-source">
              {preview.routed ? "Measured on Google driving directions." : "Measured as padded straight-line distance."}
            </span>
            {preview.fallbackReason ? <span className="delivery-preview-source">{preview.fallbackReason}</span> : null}
          </div>
        ) : null}
      </section>

      <section className="delivery-branches">
        <h2>Branch locations</h2>
        <p>Delivery is measured from these pins. A branch without one cannot fulfil a priced delivery.</p>
        <div className="compact-table">
          {branches.map((branch) => (
            <div className="compact-table-row delivery-branch-row" key={branch.id}>
              <span><Building2 /> {branch.name}</span>
              <span>{branch.address}</span>
              <span className={branch.latitude && branch.longitude ? "status-active" : "status-inactive"}>
                {branch.latitude && branch.longitude ? (
                  <><MapPin /> {Number(branch.latitude).toFixed(4)}, {Number(branch.longitude).toFixed(4)}</>
                ) : (
                  "Not pinned"
                )}
              </span>
              <Link href="/admin/stores">Edit</Link>
            </div>
          ))}
        </div>
      </section>

      {editing ? (
        <div className="product-modal" onClick={() => setEditing(null)}>
          <form onSubmit={saveBand} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{editing === "new" ? "Add distance band" : "Edit distance band"}</h2>
                <p>Bands must not overlap. The lower edge is included, the upper edge belongs to the next band.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)}><X /></button>
            </header>
            <div className="product-form-grid">
              <label className="full">
                Band name
                <input name="label" defaultValue={current?.label || ""} placeholder="0-3 km" required />
              </label>
              <label>
                From (km)
                <input name="minKm" type="number" min="0" step="0.1" defaultValue={current?.minKm ?? 0} required />
              </label>
              <label>
                To (km)
                <input name="maxKm" type="number" min="0" step="0.1" defaultValue={current?.maxKm ?? ""} required />
              </label>
              <label>
                Delivery fee (KSh)
                <input name="fee" type="number" min="0" step="1" defaultValue={current?.fee ?? ""} required />
                <small>Enter 0 to deliver free within this distance.</small>
              </label>
              <label>
                Free above (KSh)
                <input name="freeAboveSubtotal" type="number" min="0" step="1" defaultValue={current?.freeAboveSubtotal ?? ""} />
                <small>Overrides the shop-wide threshold for this band only.</small>
              </label>
              <label className="full">
                External courier
                <input name="courier" defaultValue={current?.courier || ""} placeholder="Leave blank when a Healthfield rider delivers" />
                <small>Recorded on the order so dispatch knows who is carrying it.</small>
              </label>
              <label className="check-label full">
                <input type="checkbox" name="freeDeliveryEligible" defaultChecked={current?.freeDeliveryEligible ?? true} /> Shop-wide free delivery applies to this band
              </label>
              <label className="check-label full">
                <input type="checkbox" name="isActive" defaultChecked={current?.isActive ?? true} /> Active
              </label>
            </div>
            {error ? <div className="auth-error">{error}</div> : null}
            <footer>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button disabled={busyBand !== null}>{busyBand !== null ? "Saving…" : "Save band"}</button>
            </footer>
          </form>
        </div>
      ) : null}
    </main>
  );
}
