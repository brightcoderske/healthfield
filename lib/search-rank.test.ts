import assert from "node:assert/strict";
import test from "node:test";
import { rankSearchResults, searchQueryTerms, searchRank } from "./search-rank.ts";

const product = (name: string, brand: string | null = null) => ({ name, brand });

test("a name that starts with the search ranks above everything else", () => {
  assert.equal(searchRank(product("Water for injection 10ml"), "water"), 0);
  assert.equal(searchRank(product("Rose Water Toner"), "water"), 1);
  assert.equal(searchRank(product("Saltwater rinse"), "water"), 2);
  assert.equal(searchRank(product("Panadol Extra"), "water"), 5);
});

test("names beat descriptions: the owner's example", () => {
  // Arrives description-match first, as the server's featured-then-newest order might.
  const results = [
    product("Dettol Antiseptic Liquid"), // "water" only in its description
    product("Micellar Cleansing Water"),
    product("Nivea Natural Glow"), // "water" only in its description
    product("Water for injection"),
  ];
  assert.deepEqual(
    rankSearchResults(results, "water").map((item) => item.name),
    ["Water for injection", "Micellar Cleansing Water", "Dettol Antiseptic Liquid", "Nivea Natural Glow"],
  );
});

test("every word in the name beats only some of them", () => {
  assert.equal(searchRank(product("Vitamin C 1000mg tablets"), "vitamin tablets"), 1);
  assert.equal(searchRank(product("Vitamin C syrup"), "vitamin tablets"), 3);
});

test("a brand match sits between name matches and description matches", () => {
  assert.equal(searchRank(product("Extra Strength Tablets", "Panadol"), "panadol"), 4);
  assert.ok(searchRank(product("Panadol Extra"), "panadol") < 4);
});

test("matching ignores case and punctuation in the query", () => {
  assert.equal(searchRank(product("Contus 650 Tablets"), "  CONTUS, 650 "), 0);
  assert.deepEqual(searchQueryTerms("Vitamin-C, 1000mg!"), ["vitamin-c", "1000mg"]);
});

test("products that match equally well keep the order they arrived in", () => {
  const results = [product("Cold Water Bottle"), product("Hot Water Bottle"), product("Warm Water Bottle")];
  assert.deepEqual(
    rankSearchResults(results, "water").map((item) => item.name),
    ["Cold Water Bottle", "Hot Water Bottle", "Warm Water Bottle"],
  );
});

test("single letters are dropped from a longer query but a lone letter still searches", () => {
  assert.deepEqual(searchQueryTerms("vitamin c"), ["vitamin"]);
  assert.deepEqual(searchQueryTerms("c"), ["c"]);
});

test("the typed phrase keeps its single letters, so Vitamin C leads Vitamin E", () => {
  assert.equal(searchRank(product("Vitamin C 1000mg"), "vitamin c"), 0);
  assert.equal(searchRank(product("Vitamin E 400IU"), "vitamin c"), 1);
});
