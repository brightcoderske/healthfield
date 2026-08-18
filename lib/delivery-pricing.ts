/**
 * Distance-based delivery pricing.
 *
 * Everything here is pure arithmetic over plain values so the same rules can be
 * replayed in three places without drifting: the checkout quote the customer is
 * shown, the server-side recalculation that actually takes the money, and the admin
 * preview. Nothing in this file talks to the database or to Google.
 *
 * Written without constructor parameter properties or enums: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export type GeoPoint = { latitude: number; longitude: number };

export type DeliveryBand = {
  id: number;
  label: string;
  /** Inclusive lower edge, in kilometres. */
  minKm: number;
  /** Upper edge, exclusive — except on the outermost band, where it is inclusive. */
  maxKm: number;
  fee: number;
  /** Band-specific free-delivery threshold. Overrides the global rule when set. */
  freeAboveSubtotal: number | null;
  /** Whether the global free-delivery threshold reaches this band at all. */
  freeDeliveryEligible: boolean;
  /** External courier that serves this band, or null when Healthfield delivers it. */
  courier: string | null;
  displayOrder: number;
  isActive: boolean;
};

export type OutsideCoverage = {
  mode: "BLOCK" | "CUSTOM_FEE";
  fee: number | null;
};

export type DeliveryQuote = {
  available: boolean;
  fee: number;
  free: boolean;
  distanceKm: number;
  band: DeliveryBand | null;
  courier: string | null;
  /** Threshold that would earn free delivery, when one applies to this band. */
  freeAboveSubtotal: number | null;
  /** Customer-facing sentence. Always safe to show verbatim. */
  message: string;
};

export const DELIVERY_UNAVAILABLE_MESSAGE =
  "Delivery not currently available to this location.";

/**
 * Straight-line distance between two coordinates, in kilometres.
 *
 * This is the floor, never the truth: roads are longer than the crow flies. Callers
 * either fold in a detour factor (see roadDistanceKm) or replace it entirely with a
 * routed distance from Google when a key is configured.
 */
export function haversineKm(from: GeoPoint, to: GeoPoint) {
  const earthRadiusKm = 6371.0088;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function roundKm(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Straight-line distance inflated by a detour factor, so a fallback quote does not
 * undercharge for a rider who has to follow actual roads.
 */
export function roadDistanceKm(from: GeoPoint, to: GeoPoint, detourFactor = 1.3) {
  const factor = Number.isFinite(detourFactor) && detourFactor >= 1 ? detourFactor : 1.3;
  return roundKm(haversineKm(from, to) * factor);
}

function orderedBands(bands: DeliveryBand[]) {
  return bands
    .filter((band) => band.isActive)
    .slice()
    .sort((left, right) => left.displayOrder - right.displayOrder || left.minKm - right.minKm);
}

/**
 * The band a distance falls into.
 *
 * Edges are half-open (min inclusive, max exclusive) so adjacent bands such as 0-3 and
 * 3-6 never both claim 3 km. The single exception is the outermost edge: a customer
 * sitting exactly on the last band's maximum is inside coverage, not outside it.
 */
export function matchBand(bands: DeliveryBand[], distanceKm: number): DeliveryBand | null {
  const active = orderedBands(bands);
  const halfOpen = active.find((band) => distanceKm >= band.minKm && distanceKm < band.maxKm);
  if (halfOpen) return halfOpen;
  const outermost = active.reduce<DeliveryBand | null>(
    (widest, band) => (!widest || band.maxKm > widest.maxKm ? band : widest),
    null,
  );
  if (outermost && distanceKm === outermost.maxKm) return outermost;
  return null;
}

/** Furthest kilometre any active band covers. */
export function coverageRadiusKm(bands: DeliveryBand[]) {
  return orderedBands(bands).reduce((furthest, band) => Math.max(furthest, band.maxKm), 0);
}

function applyFreeDelivery(input: {
  fee: number;
  threshold: number | null;
  subtotal: number;
  distanceKm: number;
  band: DeliveryBand | null;
  courier: string | null;
}): DeliveryQuote {
  const qualifies = input.threshold !== null && input.subtotal >= input.threshold;
  const fee = qualifies ? 0 : Math.max(0, input.fee);
  return {
    available: true,
    fee,
    free: qualifies || fee === 0,
    distanceKm: input.distanceKm,
    band: input.band,
    courier: input.courier,
    freeAboveSubtotal: input.threshold,
    message: qualifies
      ? "Delivery: FREE - Order qualifies for free delivery"
      : fee === 0
        ? "Delivery: FREE"
        : `Delivery: KSh ${fee.toLocaleString()}`,
  };
}

/**
 * Turns a distance and a basket total into the fee the customer pays.
 *
 * The order of the decisions mirrors what an administrator configured: hard service
 * radius first, then the band, then the free-delivery rule. A band may carry its own
 * threshold, opt out of the global one entirely, or inherit it.
 */
export function quoteDelivery(input: {
  distanceKm: number;
  subtotal: number;
  bands: DeliveryBand[];
  freeDeliveryThreshold: number | null;
  maxRadiusKm: number | null;
  outsideCoverage: OutsideCoverage;
}): DeliveryQuote {
  const distanceKm = roundKm(Math.max(0, input.distanceKm));
  const unavailable: DeliveryQuote = {
    available: false,
    fee: 0,
    free: false,
    distanceKm,
    band: null,
    courier: null,
    freeAboveSubtotal: null,
    message: DELIVERY_UNAVAILABLE_MESSAGE,
  };
  if (!Number.isFinite(input.distanceKm)) return unavailable;
  // A maximum service radius is a hard stop: it overrides even a custom outside fee,
  // because it exists to stop riders being sent somewhere they cannot reach.
  if (input.maxRadiusKm !== null && distanceKm > input.maxRadiusKm) return unavailable;

  const band = matchBand(input.bands, distanceKm);
  if (!band) {
    if (input.outsideCoverage.mode !== "CUSTOM_FEE" || input.outsideCoverage.fee === null) {
      return unavailable;
    }
    return applyFreeDelivery({
      fee: input.outsideCoverage.fee,
      threshold: input.freeDeliveryThreshold,
      subtotal: input.subtotal,
      distanceKm,
      band: null,
      courier: null,
    });
  }
  const threshold =
    band.freeAboveSubtotal ?? (band.freeDeliveryEligible ? input.freeDeliveryThreshold : null);
  return applyFreeDelivery({
    fee: band.fee,
    threshold,
    subtotal: input.subtotal,
    distanceKm,
    band,
    courier: band.courier,
  });
}

export type BranchPoint = {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
};

export type BasketLine = { productId: number; quantity: number };

/** branchId -> productId -> units free to sell right now. */
export type StockIndex = Map<number, Map<number, number>>;

export type RankedBranch = {
  branch: BranchPoint;
  distanceKm: number;
  linesCovered: number;
  fullyStocked: boolean;
};

export function rankBranchesByDistance(
  branches: BranchPoint[],
  point: GeoPoint,
  detourFactor = 1.3,
) {
  return branches
    .filter((branch) => branch.isActive && branch.latitude !== null && branch.longitude !== null)
    .map((branch) => ({
      branch,
      distanceKm: roadDistanceKm(
        point,
        { latitude: branch.latitude as number, longitude: branch.longitude as number },
        detourFactor,
      ),
    }))
    .sort((left, right) => left.distanceKm - right.distanceKm);
}

/**
 * Picks the branch the order is actually dispatched from.
 *
 * Delivery is charged from the branch that can fulfil the basket, not from whichever
 * branch merely happens to be closest. A nearer branch holding none of the medicines
 * would otherwise quote a cheap fee for a rider who has to set off from further away.
 * When nothing can cover the whole basket the best partial match wins, so staff still
 * see a sensible starting point rather than an arbitrary one.
 */
export function chooseFulfilmentBranch(input: {
  branches: BranchPoint[];
  point: GeoPoint;
  lines: BasketLine[];
  stock: StockIndex;
  preferredBranchId?: number | null;
  detourFactor?: number;
}): RankedBranch | null {
  const ranked = rankBranchesByDistance(input.branches, input.point, input.detourFactor).map(
    (entry) => {
      const held = input.stock.get(entry.branch.id);
      const linesCovered = input.lines.filter(
        (line) => (held?.get(line.productId) ?? 0) >= line.quantity,
      ).length;
      return {
        ...entry,
        linesCovered,
        fullyStocked: input.lines.length > 0 && linesCovered === input.lines.length,
      };
    },
  );
  if (!ranked.length) return null;
  // Staff who reassign the order override the automatic choice, and the fee is then
  // recalculated from wherever they sent it.
  if (input.preferredBranchId) {
    const preferred = ranked.find((entry) => entry.branch.id === input.preferredBranchId);
    if (preferred) return preferred;
  }
  if (!input.lines.length) return ranked[0];
  return ranked
    .slice()
    .sort(
      (left, right) =>
        Number(right.fullyStocked) - Number(left.fullyStocked) ||
        right.linesCovered - left.linesCovered ||
        left.distanceKm - right.distanceKm,
    )[0];
}

/** Rejects bands that overlap or invert, before they can mis-price a live order. */
export function validateBands(
  bands: Array<Pick<DeliveryBand, "minKm" | "maxKm" | "isActive">>,
) {
  const active = bands
    .filter((band) => band.isActive)
    .slice()
    .sort((left, right) => left.minKm - right.minKm);
  for (const band of active) {
    if (!(band.maxKm > band.minKm)) {
      return `A band must end further out than it starts (${band.minKm}-${band.maxKm} km).`;
    }
  }
  for (let index = 1; index < active.length; index += 1) {
    if (active[index].minKm < active[index - 1].maxKm) {
      return `Distance bands overlap between ${active[index - 1].minKm}-${active[index - 1].maxKm} km and ${active[index].minKm}-${active[index].maxKm} km.`;
    }
  }
  return null;
}
