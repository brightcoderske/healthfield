import assert from "node:assert/strict";
import test from "node:test";
import { apportionBundle, isBundle, isLive, normalTotal, offerPriceMap, offerTotal, type ResolvedOffer } from "./offer-pricing.ts";

const offer = (over: Partial<ResolvedOffer> & { items: ResolvedOffer["items"] }): ResolvedOffer => ({
  id: 1, title: "Offer", slug: "offer", description: null, imageUrl: null, endsAt: null, bundlePrice: null, ...over,
});
const item = (productId: number, normalPrice: number, offerPrice: number | null, quantity = 1) =>
  ({ productId, name: `P${productId}`, imageUrl: null, quantity, normalPrice, offerPrice });

test("a single-product offer replaces that product's price", () => {
  const map = offerPriceMap([offer({ items: [item(7, 500, 380)] })]);
  assert.equal(map.get(7), 380);
});

test("a bundle never alters the price of its individual products", () => {
  const group = offer({ id: 2, bundlePrice: 900, items: [item(1, 500, null), item(2, 600, null)] });
  assert.equal(isBundle(group), true);
  assert.equal(offerPriceMap([group]).size, 0);
  assert.equal(offerTotal(group), 900);
});

test("the lowest advertised price wins when offers overlap", () => {
  const map = offerPriceMap([
    offer({ id: 1, items: [item(7, 500, 420)] }),
    offer({ id: 2, items: [item(7, 500, 360)] }),
    offer({ id: 3, items: [item(7, 500, 480)] }),
  ]);
  assert.equal(map.get(7), 360, "a customer must never be charged above an advertised price");
});

test("a single item priced as a bundle still counts as a single-product offer", () => {
  // One product with a bundle price is not a group buy, so it behaves as a normal
  // offer and its per-item price is what applies.
  const single = offer({ bundlePrice: 300, items: [item(4, 500, 300)] });
  assert.equal(isBundle(single), false);
  assert.equal(offerPriceMap([single]).get(4), 300);
});

test("a single-product offer is totalled at its offer price, not the normal price", () => {
  // Reading the normal price here would advertise the offer at full price.
  const single = offer({ items: [item(2, 950, 250)] });
  assert.equal(offerTotal(single), 250);
  assert.equal(normalTotal(single), 950);
});

test("quantities are respected on both sides of the saving", () => {
  const single = offer({ items: [item(1, 200, 150, 3)] });
  assert.equal(offerTotal(single), 450);
  assert.equal(normalTotal(single), 600);
});

test("an item with no offer price falls back to its normal price in the total", () => {
  const mixed = offer({ items: [item(1, 200, null)] });
  assert.equal(offerTotal(mixed), 200);
});

test("items without an offer price are ignored rather than treated as free", () => {
  const map = offerPriceMap([offer({ items: [item(9, 400, null)] })]);
  assert.equal(map.has(9), false);
});

test("liveness follows the offer window", () => {
  const hour = 3_600_000;
  const now = new Date("2026-08-11T12:00:00Z");
  const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * hour);
  const cases: Array<[string, { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, boolean]> = [
    ["open ended and on", { isActive: true, startsAt: null, endsAt: null }, true],
    ["switched off by an admin", { isActive: false, startsAt: null, endsAt: null }, false],
    ["ends in the future", { isActive: true, startsAt: null, endsAt: at(1) }, true],
    ["ended an hour ago", { isActive: true, startsAt: null, endsAt: at(-1) }, false],
    ["ends exactly now", { isActive: true, startsAt: null, endsAt: now }, false],
    ["not started yet", { isActive: true, startsAt: at(1), endsAt: null }, false],
    ["already started", { isActive: true, startsAt: at(-1), endsAt: at(1) }, true],
  ];
  for (const [label, offer, expected] of cases) assert.equal(isLive(offer, now), expected, label);
});

test("a bundle price is split across its products without gaining or losing a cent", () => {
  const cases: Array<[number, number[]]> = [
    [90000, [50000, 60000]],
    [100, [1, 1, 1]],          // indivisible remainder
    [999, [333, 333, 333]],
    [1, [500, 500]],           // less money than parts
    [0, [500, 500]],           // free bundle
    [123457, [1, 99999, 4]],
    [5000, [0, 0]],            // no usable weights
  ];
  for (const [total, weights] of cases) {
    const shares = apportionBundle(total, weights);
    assert.equal(shares.length, weights.length, `line count for ${total}`);
    assert.equal(shares.reduce((sum, share) => sum + share, 0), total, `shares must total exactly ${total}`);
    assert.ok(shares.every((share) => share >= 0), `no negative share for ${total}`);
  }
});

test("bundle shares follow what each product normally costs", () => {
  const [cheap, dear] = apportionBundle(90000, [30000, 60000]);
  assert.ok(dear > cheap, "the pricier product should carry the larger share");
  assert.equal(cheap + dear, 90000);
});
