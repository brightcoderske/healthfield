import assert from "node:assert/strict";
import test from "node:test";
import { readStorefrontFilters, writeStorefrontFilters } from "./storefront-url.ts";

const categories = [{ id: 3, slug: "pain-relief-x1" }, { id: 8, slug: "vitamins-y2" }];
const conditions = [{ id: 5, slug: "malaria-z3" }];

test("a search in the address bar is read back, so Back returns to it", () => {
  assert.deepEqual(readStorefrontFilters("?q=paracetamol", categories, conditions), { query: "paracetamol", categoryId: null, conditionId: null });
  assert.deepEqual(readStorefrontFilters("?q=vitamin%20c", categories, conditions).query, "vitamin c");
});

test("a category or condition in the address bar is read back as its id", () => {
  assert.deepEqual(readStorefrontFilters("?category=vitamins-y2", categories, conditions), { query: "", categoryId: 8, conditionId: null });
  assert.deepEqual(readStorefrontFilters("?condition=malaria-z3", categories, conditions), { query: "", categoryId: null, conditionId: 5 });
});

test("an unknown slug, or an empty address, means no filter rather than an error", () => {
  assert.deepEqual(readStorefrontFilters("?category=gone&condition=nope", categories, conditions), { query: "", categoryId: null, conditionId: null });
  assert.deepEqual(readStorefrontFilters("", categories, conditions), { query: "", categoryId: null, conditionId: null });
});

test("writing the filters sets only the ones in force and trims the search", () => {
  assert.equal(writeStorefrontFilters("", { query: "  panadol ", categorySlug: null, conditionSlug: null }), "q=panadol");
  assert.equal(writeStorefrontFilters("", { query: "", categorySlug: "vitamins-y2", conditionSlug: null }), "category=vitamins-y2");
  assert.equal(writeStorefrontFilters("", { query: "", categorySlug: null, conditionSlug: "malaria-z3" }), "condition=malaria-z3");
  assert.equal(writeStorefrontFilters("?q=old&category=a&condition=b", { query: "", categorySlug: null, conditionSlug: null }), "");
});

test("other parts of the address are left exactly as they were", () => {
  assert.equal(writeStorefrontFilters("?offers=1", { query: "zinc", categorySlug: null, conditionSlug: null }), "offers=1&q=zinc");
  assert.equal(writeStorefrontFilters("?offers=1&q=zinc", { query: "", categorySlug: null, conditionSlug: null }), "offers=1");
});

test("what is written is what is read back", () => {
  for (const filters of [
    { query: "cough syrup", categorySlug: null, conditionSlug: null },
    { query: "", categorySlug: "pain-relief-x1", conditionSlug: null },
    { query: "", categorySlug: null, conditionSlug: "malaria-z3" },
    { query: "", categorySlug: null, conditionSlug: null },
  ]) {
    const read = readStorefrontFilters(`?${writeStorefrontFilters("", filters)}`, categories, conditions);
    assert.equal(read.query, filters.query);
    assert.equal(read.categoryId, categories.find((item) => item.slug === filters.categorySlug)?.id ?? null);
    assert.equal(read.conditionId, conditions.find((item) => item.slug === filters.conditionSlug)?.id ?? null);
  }
});
