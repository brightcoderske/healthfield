import assert from "node:assert/strict";
import test from "node:test";
import { FEATURED_LIMIT, FEATURED_VISIBLE, featuredEvictions, featuredWindow, homeCatalogueOrder } from "./featured-products.ts";

const shelf = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => ({
    id: from + index,
    featuredAt: new Date(2026, 0, from + index).toISOString(),
  }));

test("a shelf with room evicts nothing", () => {
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT - 1), 99), []);
  assert.deepEqual(featuredEvictions([], 99), []);
});

test("one more than the shelf holds pushes off the one featured longest ago", () => {
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), 99), [1]);
});

test("re-saving a product already on the shelf evicts nobody", () => {
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), 1), []);
  assert.deepEqual(featuredEvictions(shelf(FEATURED_LIMIT), FEATURED_LIMIT), []);
});

test("a shelf left over-full by older data is trimmed back to the limit, oldest first", () => {
  const over = FEATURED_LIMIT + 3;
  assert.deepEqual(featuredEvictions(shelf(over), 99), [1, 2, 3, 4]);
  assert.deepEqual(featuredEvictions(shelf(over), null), [1, 2, 3]);
});

test("the shelf holds enough to rotate through, and shows fewer than it holds", () => {
  assert.equal(FEATURED_LIMIT, 30);
  assert.ok(FEATURED_VISIBLE >= 10 && FEATURED_VISIBLE <= 20 && FEATURED_VISIBLE < FEATURED_LIMIT);
});

test("a product with no recorded featuring moment is treated as the oldest", () => {
  // Production reads a never-set timestamp back as a zero date, not as null.
  const rows = [{ id: 7, featuredAt: null }, { id: 8, featuredAt: "0000-00-00 00:00:00" }, ...shelf(FEATURED_LIMIT - 1, 10)];
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

test("a shelf that fits on screen is shown whole and never rotates", () => {
  const pool = Array.from({ length: FEATURED_VISIBLE }, (_, index) => index);
  assert.deepEqual(featuredWindow(pool, 0), pool);
  assert.deepEqual(featuredWindow(pool, 7), pool);
});

test("a long shelf is dealt out a screenful at a time and wraps round", () => {
  const pool = Array.from({ length: 30 }, (_, index) => index);
  const first = featuredWindow(pool, 0, 12);
  const second = featuredWindow(pool, 1, 12);
  assert.deepEqual(first, pool.slice(0, 12));
  assert.deepEqual(second, pool.slice(12, 24));
  // The short last batch is topped up from the front, so the rail never shrinks.
  const third = featuredWindow(pool, 2, 12);
  assert.equal(third.length, 12);
  assert.deepEqual(third, [...pool.slice(24, 30), ...pool.slice(0, 6)]);
});

test("every featured product gets the same airtime over a full cycle", () => {
  const pool = Array.from({ length: 30 }, (_, index) => index);
  const seen = new Map<number, number>();
  // 30 products at 12 a screen repeat every 5 steps (lcm of 30 and 12 is 60 = 5 screens).
  for (let step = 0; step < 5; step += 1) for (const id of featuredWindow(pool, step, 12)) seen.set(id, (seen.get(id) ?? 0) + 1);
  assert.equal(seen.size, 30);
  assert.deepEqual([...new Set(seen.values())], [2]);
});

test("a negative step still lands inside the shelf", () => {
  const pool = Array.from({ length: 30 }, (_, index) => index);
  assert.equal(featuredWindow(pool, -1, 12).length, 12);
});
