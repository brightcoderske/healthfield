import assert from "node:assert/strict";
import test from "node:test";
import { FEATURED_LIMIT, featuredEvictions, homeCatalogueOrder } from "./featured-products.ts";

const shelf = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => ({
    id: from + index,
    featuredAt: new Date(2026, 0, from + index).toISOString(),
  }));

test("a shelf with room evicts nothing", () => {
  assert.deepEqual(featuredEvictions(shelf(9), 99), []);
  assert.deepEqual(featuredEvictions([], 99), []);
});

test("an eleventh featured product pushes off the one featured longest ago", () => {
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), 99), [1]);
});

test("re-saving a product already on the shelf evicts nobody", () => {
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), 1), []);
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), FEATURED_LIMIT), []);
});

test("a shelf left over-full by older data is trimmed back to ten, oldest first", () => {
  assert.deepEqual(featuredEvictions(shelf(13), 99), [1, 2, 3, 4]);
  assert.deepEqual(featuredEvictions(shelf(13), null), [1, 2, 3]);
});

test("a product with no recorded featuring moment is treated as the oldest", () => {
  // Production reads a never-set timestamp back as a zero date, not as null.
  const rows = [{ id: 7, featuredAt: null }, { id: 8, featuredAt: "0000-00-00 00:00:00" }, ...shelf(9, 10)];
  assert.deepEqual(featuredEvictions(rows, 99), [7, 8]);
});

test("the homepage leads with the featured products and shuffles the rest", () => {
  const catalog = [
    ...Array.from({ length: 4 }, (_, index) => ({ id: index + 1, isFeatured: true })),
    ...Array.from({ length: 30 }, (_, index) => ({ id: index + 100, isFeatured: false })),
  ];
  const order = homeCatalogueOrder(catalog, 12345);
  assert.deepEqual(order.slice(0, 4).map((product) => product.id).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(order.length, catalog.length);
  assert.deepEqual(new Set(order.map((product) => product.id)).size, catalog.length);
});

test("a different seed lays the homepage out differently, the same seed repeats it", () => {
  const catalog = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, isFeatured: false }));
  const first = homeCatalogueOrder(catalog, 1).map((product) => product.id);
  const again = homeCatalogueOrder(catalog, 1).map((product) => product.id);
  const other = homeCatalogueOrder(catalog, 2).map((product) => product.id);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, other);
});
