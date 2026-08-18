import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseFulfilmentBranch,
  coverageRadiusKm,
  haversineKm,
  matchBand,
  quoteDelivery,
  roadDistanceKm,
  validateBands,
  type DeliveryBand,
} from "./delivery-pricing.ts";

function band(overrides: Partial<DeliveryBand> & Pick<DeliveryBand, "id" | "minKm" | "maxKm" | "fee">): DeliveryBand {
  return {
    label: `${overrides.minKm}-${overrides.maxKm} km`,
    freeAboveSubtotal: null,
    freeDeliveryEligible: true,
    courier: null,
    displayOrder: overrides.id,
    isActive: true,
    ...overrides,
  };
}

// The owner's worked example, kept verbatim so a pricing change has to break a test.
const bands = [
  band({ id: 1, minKm: 0, maxKm: 3, fee: 200 }),
  band({ id: 2, minKm: 3, maxKm: 6, fee: 300 }),
  band({ id: 3, minKm: 6, maxKm: 10, fee: 450 }),
  band({ id: 4, minKm: 10, maxKm: 15, fee: 600 }),
];

const blocked = { mode: "BLOCK" as const, fee: null };

test("a distance lands in exactly one band", () => {
  assert.equal(matchBand(bands, 0)?.fee, 200);
  assert.equal(matchBand(bands, 2.9)?.fee, 200);
  // The shared edge belongs to the outer band, never to both.
  assert.equal(matchBand(bands, 3)?.fee, 300);
  assert.equal(matchBand(bands, 6)?.fee, 450);
  assert.equal(matchBand(bands, 9.99)?.fee, 450);
  assert.equal(matchBand(bands, 10)?.fee, 600);
});

test("a band may cost nothing, so a shop can deliver free close to home", () => {
  // The admin's own worked example: free inside 3 km, KSh 200 out to 10 km.
  const nearby = [
    band({ id: 1, minKm: 0, maxKm: 3, fee: 0 }),
    band({ id: 2, minKm: 3, maxKm: 10, fee: 200 }),
  ];
  const close = quoteDelivery({
    distanceKm: 2.4,
    subtotal: 300,
    bands: nearby,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(close.available, true);
  assert.equal(close.fee, 0);
  assert.equal(close.free, true);

  const further = quoteDelivery({
    distanceKm: 7,
    subtotal: 300,
    bands: nearby,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(further.fee, 200);
  assert.equal(further.free, false);
  // Past the last band there is still no delivery, free or otherwise.
  assert.equal(matchBand(nearby, 11), null);
});

test("the outermost edge is inclusive so exactly 15 km is still covered", () => {
  assert.equal(matchBand(bands, 15)?.fee, 600);
  assert.equal(matchBand(bands, 15.01), null);
  assert.equal(coverageRadiusKm(bands), 15);
});

test("a deactivated band is skipped rather than silently charged", () => {
  const withoutMiddle = bands.map((entry) => (entry.id === 2 ? { ...entry, isActive: false } : entry));
  assert.equal(matchBand(withoutMiddle, 4), null);
  const quote = quoteDelivery({
    distanceKm: 4,
    subtotal: 900,
    bands: withoutMiddle,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(quote.available, false);
});

test("a location outside every band is refused when no custom fee is configured", () => {
  const quote = quoteDelivery({
    distanceKm: 22,
    subtotal: 5000,
    bands,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(quote.available, false);
  assert.equal(quote.fee, 0);
  assert.match(quote.message, /not currently available/i);
});

test("an outside-coverage fee lets the admin serve far customers instead of turning them away", () => {
  const quote = quoteDelivery({
    distanceKm: 22,
    subtotal: 900,
    bands,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: { mode: "CUSTOM_FEE", fee: 1200 },
  });
  assert.equal(quote.available, true);
  assert.equal(quote.fee, 1200);
  assert.equal(quote.band, null);
});

test("a maximum service radius overrides even a custom outside fee", () => {
  // The radius exists to stop riders being dispatched somewhere unreachable, so a
  // configured fallback fee must not quietly reopen coverage past it.
  const quote = quoteDelivery({
    distanceKm: 40,
    subtotal: 9000,
    bands,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: 25,
    outsideCoverage: { mode: "CUSTOM_FEE", fee: 1200 },
  });
  assert.equal(quote.available, false);
});

test("the global free-delivery threshold clears the fee once the basket is big enough", () => {
  const under = quoteDelivery({
    distanceKm: 4,
    subtotal: 1499,
    bands,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(under.fee, 300);
  assert.equal(under.free, false);
  assert.equal(under.freeAboveSubtotal, 1500);

  const over = quoteDelivery({
    distanceKm: 4,
    subtotal: 1500,
    bands,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(over.fee, 0);
  assert.equal(over.free, true);
  assert.match(over.message, /FREE/);
});

test("a long-distance band can opt out of free delivery entirely", () => {
  // 0-6 km qualifies above KSh 1,500; the 10-15 km run still has to be paid for.
  const opted = bands.map((entry) => (entry.minKm >= 6 ? { ...entry, freeDeliveryEligible: false } : entry));
  const near = quoteDelivery({
    distanceKm: 4,
    subtotal: 2000,
    bands: opted,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  const far = quoteDelivery({
    distanceKm: 12,
    subtotal: 2000,
    bands: opted,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(near.fee, 0);
  assert.equal(far.fee, 600);
  assert.equal(far.freeAboveSubtotal, null);
});

test("a band threshold overrides the global one in both directions", () => {
  const custom = bands.map((entry) => (entry.id === 4 ? { ...entry, freeAboveSubtotal: 5000 } : entry));
  const stillCharged = quoteDelivery({
    distanceKm: 12,
    subtotal: 3000,
    bands: custom,
    freeDeliveryThreshold: 1500,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(stillCharged.fee, 600);
  const freed = quoteDelivery({
    distanceKm: 12,
    subtotal: 5000,
    bands: custom,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(freed.fee, 0);
});

test("a courier band reports who is carrying the order", () => {
  const outsourced = bands.map((entry) => (entry.id === 4 ? { ...entry, courier: "Sendy" } : entry));
  const quote = quoteDelivery({
    distanceKm: 12,
    subtotal: 500,
    bands: outsourced,
    freeDeliveryThreshold: null,
    maxRadiusKm: null,
    outsideCoverage: blocked,
  });
  assert.equal(quote.courier, "Sendy");
});

test("overlapping or inverted bands are rejected before they can price an order", () => {
  assert.equal(validateBands(bands), null);
  assert.match(
    validateBands([band({ id: 1, minKm: 0, maxKm: 5, fee: 100 }), band({ id: 2, minKm: 3, maxKm: 8, fee: 200 })]) || "",
    /overlap/i,
  );
  assert.match(validateBands([band({ id: 1, minKm: 5, maxKm: 5, fee: 100 })]) || "", /further out/i);
  // An inactive band may sit anywhere; it prices nothing.
  assert.equal(
    validateBands([
      band({ id: 1, minKm: 0, maxKm: 5, fee: 100 }),
      band({ id: 2, minKm: 3, maxKm: 8, fee: 200, isActive: false }),
    ]),
    null,
  );
});

test("distance is measured on the ground and padded for real roads", () => {
  const juja = { latitude: -1.1018, longitude: 37.0144 };
  const thika = { latitude: -1.0333, longitude: 37.0693 };
  const straight = haversineKm(juja, thika);
  assert.ok(straight > 9 && straight < 11, `unexpected straight-line distance ${straight}`);
  assert.ok(roadDistanceKm(juja, thika) > straight);
  assert.equal(haversineKm(juja, juja), 0);
});

const branches = [
  { id: 1, name: "Juja", latitude: -1.1018, longitude: 37.0144, isActive: true },
  { id: 2, name: "Thika", latitude: -1.0333, longitude: 37.0693, isActive: true },
  { id: 3, name: "Closed", latitude: -1.1, longitude: 37.014, isActive: false },
];
const basket = [
  { productId: 10, quantity: 2 },
  { productId: 11, quantity: 1 },
];

test("the nearest branch fulfils the order when it holds the stock", () => {
  const stock = new Map([
    [1, new Map([[10, 5], [11, 5]])],
    [2, new Map([[10, 5], [11, 5]])],
  ]);
  const chosen = chooseFulfilmentBranch({ branches, point: { latitude: -1.1, longitude: 37.015 }, lines: basket, stock });
  assert.equal(chosen?.branch.id, 1);
  assert.equal(chosen?.fullyStocked, true);
});

test("delivery is charged from the branch that can actually fulfil, not the closest one", () => {
  // This is the whole point of the rule: the near branch is empty, so the fee must
  // reflect the van that really sets off from Thika.
  const stock = new Map([
    [1, new Map([[10, 0], [11, 0]])],
    [2, new Map([[10, 5], [11, 5]])],
  ]);
  const near = { latitude: -1.1, longitude: 37.015 };
  const chosen = chooseFulfilmentBranch({ branches, point: near, lines: basket, stock });
  assert.equal(chosen?.branch.id, 2);
  assert.equal(chosen?.fullyStocked, true);
  assert.ok((chosen?.distanceKm ?? 0) > 5, "the fee should be quoted from the further branch");
});

test("a partially stocked branch beats one holding nothing", () => {
  const stock = new Map([
    [1, new Map([[10, 0], [11, 0]])],
    [2, new Map([[10, 5], [11, 0]])],
  ]);
  const chosen = chooseFulfilmentBranch({ branches, point: { latitude: -1.1, longitude: 37.015 }, lines: basket, stock });
  assert.equal(chosen?.branch.id, 2);
  assert.equal(chosen?.fullyStocked, false);
  assert.equal(chosen?.linesCovered, 1);
});

test("reassigning the fulfilment branch re-prices from that branch", () => {
  const stock = new Map([
    [1, new Map([[10, 5], [11, 5]])],
    [2, new Map([[10, 5], [11, 5]])],
  ]);
  const point = { latitude: -1.1, longitude: 37.015 };
  const automatic = chooseFulfilmentBranch({ branches, point, lines: basket, stock });
  const reassigned = chooseFulfilmentBranch({ branches, point, lines: basket, stock, preferredBranchId: 2 });
  assert.equal(automatic?.branch.id, 1);
  assert.equal(reassigned?.branch.id, 2);
  assert.ok((reassigned?.distanceKm ?? 0) > (automatic?.distanceKm ?? 0));
});

test("branches without a saved map pin cannot quote a distance", () => {
  const unpinned = [{ id: 4, name: "Unpinned", latitude: null, longitude: null, isActive: true }];
  const stock = new Map([[4, new Map([[10, 5], [11, 5]])]]);
  assert.equal(chooseFulfilmentBranch({ branches: unpinned, point: { latitude: -1.1, longitude: 37 }, lines: basket, stock }), null);
});
