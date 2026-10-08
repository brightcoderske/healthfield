import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBackend, SharedCache } from "./cache.ts";
import { changesCatalogue, publicViewTtlSeconds, serveCachedView, viewCacheKey } from "./catalogue-cache.ts";

test("only the public pages are cached; anything tied to a person never is", () => {
  for (const view of ["home", "browse", "search", "products/12", "blogs", "blogs/a-slug", "locations", "conditions", "sitemap", "merchant"]) {
    assert.ok(publicViewTtlSeconds(view) > 0, `${view} should be cached`);
  }
  for (const view of ["account", "account/orders/5", "account/payable-prescriptions", "checkout", "consultations", "admin/settings", "admin/orders", "staff/orders", "staff/dashboard", "walk-in-sale", "catalogue", "products/12/reviews", "unknown"]) {
    assert.equal(publicViewTtlSeconds(view), 0, `${view} must not be cached`);
  }
});

test("the same request written two ways shares one entry", () => {
  assert.equal(viewCacheKey("3", "search", "?q=Panadol&b=2&a=1"), viewCacheKey("3", "search", "?a=1&b=2&q=panadol"));
  assert.equal(viewCacheKey("3", "search", "?q=  Cough   Syrup "), viewCacheKey("3", "search", "?q=cough syrup"));
  assert.notEqual(viewCacheKey("3", "search", "?q=a"), viewCacheKey("3", "search", "?q=b"));
  assert.equal(viewCacheKey("3", "home", ""), "view:3:home");
});

test("a new catalogue version means a different key, so old entries are never asked for again", () => {
  assert.notEqual(viewCacheKey("3", "home", ""), viewCacheKey("4", "home", ""));
});

test("an enormous query string is not cached", () => {
  assert.equal(viewCacheKey("1", "search", `?q=${"a".repeat(400)}`), null);
});

test("edits to the catalogue make cached pages stale; reads and failures do not", () => {
  assert.equal(changesCatalogue("PATCH", "/v1/products/5", 200), true);
  assert.equal(changesCatalogue("POST", "/v1/products", 201), true);
  assert.equal(changesCatalogue("DELETE", "/v1/offers/2", 200), true);
  assert.equal(changesCatalogue("PUT", "/v1/settings", 200), true);
  assert.equal(changesCatalogue("POST", "/v1/products/5/reviews", 201), true);
  assert.equal(changesCatalogue("PATCH", "/v1/stores/1", 200), true);
  assert.equal(changesCatalogue("POST", "/v1/categories", 201), true);
  assert.equal(changesCatalogue("PATCH", "/v1/promotional-banners/3", 200), true);
  assert.equal(changesCatalogue("GET", "/v1/products/5", 200), false);
  assert.equal(changesCatalogue("PATCH", "/v1/products/5", 400), false, "a rejected edit changed nothing");
  assert.equal(changesCatalogue("POST", "/v1/orders", 201), false);
  assert.equal(changesCatalogue("POST", "/v1/auth/login", 200), false);
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" } });
}

test("a public view is built once, then served from the cache with its headers", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let builds = 0;
  const build = async () => { builds += 1; return jsonResponse({ products: [1, 2, 3] }); };
  const first = await serveCachedView(cache, "home", "", build);
  const second = await serveCachedView(cache, "home", "", build);
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.equal(builds, 1);
  assert.deepEqual(await second.json(), { products: [1, 2, 3] });
  assert.equal(second.headers.get("content-type"), "application/json");
  assert.equal(second.headers.get("cache-control"), "public, max-age=30");
});

test("an error response is passed on but never kept", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let builds = 0;
  const build = async () => { builds += 1; return jsonResponse({ error: "Product not found." }, 404); };
  const first = await serveCachedView(cache, "products/9", "", build);
  const second = await serveCachedView(cache, "products/9", "", build);
  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
  assert.equal(builds, 2, "a 404 must be asked again, so the product appears the moment it exists");
});

test("a view tied to a person is built fresh every time", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let builds = 0;
  const build = async () => { builds += 1; return jsonResponse({ orders: [] }); };
  await serveCachedView(cache, "account", "", build);
  await serveCachedView(cache, "account", "", build);
  assert.equal(builds, 2);
});

test("after a catalogue change the next request sees fresh data, not the old page", async () => {
  const backend = new MemoryBackend();
  const cache = new SharedCache(backend, { versionTrustMs: 0 });
  let price = 100;
  const build = async () => jsonResponse({ price });
  assert.deepEqual(await (await serveCachedView(cache, "products/1", "", build)).json(), { price: 100 });
  price = 150;
  assert.deepEqual(await (await serveCachedView(cache, "products/1", "", build)).json(), { price: 100 }, "still cached until something changes");
  await cache.bumpCatalogue();
  assert.deepEqual(await (await serveCachedView(cache, "products/1", "", build)).json(), { price: 150 });
});

test("with Redis down, pages are simply built each time and the site stays up", async () => {
  const dead = { async get() { throw new Error("down"); }, async set() { throw new Error("down"); }, async increment(): Promise<number> { throw new Error("down"); } };
  const cache = new SharedCache(dead);
  let builds = 0;
  const response = await serveCachedView(cache, "home", "", async () => { builds += 1; return jsonResponse({ ok: true }); });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(builds, 1);
});

test("with no Redis configured the view is passed straight through untouched", async () => {
  const cache = new SharedCache(null);
  const response = await serveCachedView(cache, "home", "", async () => jsonResponse({ ok: true }));
  assert.equal(response.headers.get("x-cache"), null);
  assert.deepEqual(await response.json(), { ok: true });
});
