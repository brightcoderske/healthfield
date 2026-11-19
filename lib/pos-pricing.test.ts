import assert from "node:assert/strict";
import test from "node:test";
import { buildPosLines, deliveryFeeWasChanged } from "./pos-pricing.ts";

const shelf = new Map([
  [1, { name: "Panadol 24s", shelfPrice: 120 }],
  [2, { name: "Vitamin C 1000mg", shelfPrice: 850 }],
]);

test("without a price change every line sells at the shelf price and nothing is recorded", () => {
  const result = buildPosLines([{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }], shelf);
  assert.ok(result.ok);
  assert.deepEqual(result.lines.map((line) => [line.productId, line.unitPrice, line.base]), [[1, 120, 240], [2, 850, 850]]);
  assert.deepEqual(result.priceChanges, []);
});

test("a changed price is charged and recorded with the shelf price beside it", () => {
  const result = buildPosLines([{ productId: 2, quantity: 2, unitPrice: 799.999 }], shelf);
  assert.ok(result.ok);
  assert.equal(result.lines[0].unitPrice, 800, "rounded to the cent");
  assert.equal(result.lines[0].base, 1600);
  assert.deepEqual(result.priceChanges, [{ productId: 2, name: "Vitamin C 1000mg", shelfPrice: 850, unitPrice: 800 }]);
});

test("a price can be raised as well as lowered", () => {
  const result = buildPosLines([{ productId: 1, quantity: 1, unitPrice: 150 }], shelf);
  assert.ok(result.ok);
  assert.equal(result.priceChanges[0].unitPrice, 150);
});

test("sending the shelf price as the price is not a change", () => {
  const result = buildPosLines([{ productId: 1, quantity: 1, unitPrice: 120 }], shelf);
  assert.ok(result.ok);
  assert.deepEqual(result.priceChanges, []);
});

test("the same product sent twice adds up, but only at one price", () => {
  const same = buildPosLines([{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }], shelf);
  assert.ok(same.ok);
  assert.deepEqual(same.lines.map((line) => [line.quantity, line.base]), [[3, 360]]);
  const clash = buildPosLines([{ productId: 1, quantity: 1, unitPrice: 100 }, { productId: 1, quantity: 1 }], shelf);
  assert.equal(clash.ok, false);
  assert.match(!clash.ok ? clash.error : "", /two different prices/);
});

test("a zero, negative or nonsense price is refused, as is a product not on sale", () => {
  for (const unitPrice of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = buildPosLines([{ productId: 1, quantity: 1, unitPrice }], shelf);
    assert.equal(result.ok, false, String(unitPrice));
  }
  assert.equal(buildPosLines([{ productId: 99, quantity: 1 }], shelf).ok, false);
});

test("a delivery fee differing from the calculated one, or with none calculated, counts as set by hand", () => {
  assert.equal(deliveryFeeWasChanged(250, 250), false);
  assert.equal(deliveryFeeWasChanged(250.001, 250), false, "a rounding difference is not a change");
  assert.equal(deliveryFeeWasChanged(0, 250), true, "free delivery given by the cashier");
  assert.equal(deliveryFeeWasChanged(300, null), true, "no location pinned");
});
