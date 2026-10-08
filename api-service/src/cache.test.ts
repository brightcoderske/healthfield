import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBackend, SharedCache, type CacheBackend } from "./cache.ts";

/** A clock the test moves by hand, so expiry is checked without waiting. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

/** A backend that fails the way a dead or slow Redis does. */
function broken(mode: "throw" | "hang"): CacheBackend & { calls: number } {
  const backend = {
    calls: 0,
    async get() { backend.calls += 1; if (mode === "hang") return new Promise<string | null>(() => undefined); throw new Error("connection refused"); },
    async set() { backend.calls += 1; if (mode === "hang") return new Promise<void>(() => undefined); throw new Error("connection refused"); },
    async increment() { backend.calls += 1; if (mode === "hang") return new Promise<number>(() => undefined); throw new Error("connection refused"); },
    async acquire() { backend.calls += 1; if (mode === "hang") return new Promise<boolean>(() => undefined); throw new Error("connection refused"); },
    async release() { backend.calls += 1; if (mode === "hang") return new Promise<void>(() => undefined); throw new Error("connection refused"); },
  };
  return backend;
}

test("a value comes back until its time is up, then is gone", async () => {
  const time = clock();
  const cache = new SharedCache(new MemoryBackend(time.now), { clock: time.now });
  await cache.set("greeting", "hello", 60);
  assert.equal(await cache.get("greeting"), "hello");
  time.advance(59_000);
  assert.equal(await cache.get("greeting"), "hello");
  time.advance(2_000);
  assert.equal(await cache.get("greeting"), null);
});

test("with no Redis configured every read is a miss and nothing breaks", async () => {
  const cache = new SharedCache(null);
  assert.equal(cache.status, "disabled");
  await cache.set("a", "b", 60);
  assert.equal(await cache.get("a"), null);
  assert.equal(await cache.catalogueVersion(), "0");
  await cache.bumpCatalogue();
});

test("a failing backend is left alone for a cooldown, then tried again", async () => {
  const time = clock();
  const backend = broken("throw");
  const errors: string[] = [];
  const cache = new SharedCache(backend, { clock: time.now, failureCooldownMs: 10_000, onError: (_e, operation) => errors.push(operation) });
  assert.equal(await cache.get("k"), null);
  assert.equal(cache.status, "down");
  assert.equal(backend.calls, 1);
  // Inside the cooldown nothing is sent to it at all, so a dead server costs requests nothing.
  for (let i = 0; i < 20; i += 1) await cache.get("k");
  assert.equal(backend.calls, 1);
  time.advance(10_001);
  assert.equal(cache.status, "up");
  await cache.get("k");
  assert.equal(backend.calls, 2);
  assert.deepEqual(errors, ["get", "get"]);
});

test("a backend too slow to answer counts as down, and never holds a request up", async () => {
  const cache = new SharedCache(broken("hang"), { operationTimeoutMs: 20 });
  const started = Date.now();
  assert.equal(await cache.get("k"), null);
  assert.ok(Date.now() - started < 500, "the request waited on a hung cache");
  assert.equal(cache.status, "down");
});

test("remember builds once, then serves from the cache", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let builds = 0;
  const build = async () => { builds += 1; return { n: builds }; };
  const first = await cache.remember("page", 60, build);
  const second = await cache.remember("page", 60, build);
  assert.deepEqual([first.cached, first.value.n], [false, 1]);
  assert.deepEqual([second.cached, second.value.n], [true, 1]);
  assert.equal(builds, 1);
});

test("a rush for the same missing key builds it once and shares the answer", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let builds = 0;
  const build = async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return "built"; };
  const results = await Promise.all(Array.from({ length: 10 }, () => cache.remember("busy", 60, build)));
  assert.equal(builds, 1);
  assert.ok(results.every((result) => result.value === "built"));
});

test("a value that is not fit to keep is returned but not stored", async () => {
  const cache = new SharedCache(new MemoryBackend());
  const failure = { status: 500 };
  const result = await cache.remember("bad", 60, async () => failure, (value) => value.status === 200);
  assert.deepEqual(result.value, failure);
  assert.equal(await cache.get("bad"), null);
});

test("an unreadable stored entry is rebuilt, not trusted", async () => {
  const cache = new SharedCache(new MemoryBackend());
  await cache.set("page", "{not json", 60);
  const result = await cache.remember("page", 60, async () => ({ ok: true }));
  assert.deepEqual([result.cached, result.value], [false, { ok: true }]);
});

test("a rate limit counts across workers that share a backend", async () => {
  const shared = new MemoryBackend();
  const workerA = new SharedCache(shared);
  const workerB = new SharedCache(shared);
  const answers: boolean[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) answers.push(await (attempt % 2 ? workerA : workerB).rateLimited("1.2.3.4:login", 3, 900));
  // Five attempts split between two workers: the fourth and fifth are over the limit of three.
  assert.deepEqual(answers, [false, false, false, true, true]);
});

test("a rate limit window ends and starts over", async () => {
  const time = clock();
  const cache = new SharedCache(new MemoryBackend(time.now), { clock: time.now });
  for (let i = 0; i < 3; i += 1) assert.equal(await cache.rateLimited("ip:login", 3, 900), false);
  assert.equal(await cache.rateLimited("ip:login", 3, 900), true);
  time.advance(901_000);
  assert.equal(await cache.rateLimited("ip:login", 3, 900), false);
});

test("when Redis is down, rate limiting keeps working in memory instead of failing open or shut", async () => {
  const cache = new SharedCache(broken("throw"));
  const answers: boolean[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) answers.push(await cache.rateLimited("ip:login", 2, 900));
  assert.deepEqual(answers, [false, false, true, true]);
});

test("a catalogue change moves the version, and other workers pick it up after a moment", async () => {
  const time = clock();
  const shared = new MemoryBackend(time.now);
  const editor = new SharedCache(shared, { clock: time.now, versionTrustMs: 1_000 });
  const reader = new SharedCache(shared, { clock: time.now, versionTrustMs: 1_000 });
  const before = await reader.catalogueVersion();
  await editor.bumpCatalogue();
  assert.notEqual(await editor.catalogueVersion(), before, "the editing worker sees its own change at once");
  assert.equal(await reader.catalogueVersion(), before, "a reader trusts what it read for a second");
  time.advance(1_001);
  assert.equal(await reader.catalogueVersion(), await editor.catalogueVersion());
});

test("keys are prefixed, so this site cannot collide with anything else in the same Redis", async () => {
  const backend = new MemoryBackend();
  const cache = new SharedCache(backend, { prefix: "hf:" });
  await cache.set("page", "x", 60);
  assert.deepEqual([...backend.entries.keys()], ["hf:page"]);
});

test("the in-memory backend does not grow without bound", async () => {
  const time = clock();
  const backend = new MemoryBackend(time.now);
  for (let i = 0; i < 6000; i += 1) await backend.set(`k${i}`, "v", 10);
  time.advance(11_000);
  await backend.set("fresh", "v", 10);
  for (let i = 0; i < 200; i += 1) await backend.get("fresh");
  assert.ok(backend.entries.size < 100, `still holding ${backend.entries.size} expired entries`);
});

test("versions are kept per namespace, so bumping one leaves the others alone", async () => {
  const cache = new SharedCache(new MemoryBackend(), { versionTrustMs: 0 });
  const before = { catalogue: await cache.version("catalogue"), sessions: await cache.version("sessions"), counts: await cache.version("counts") };
  await cache.bump("sessions");
  assert.equal(await cache.version("catalogue"), before.catalogue);
  assert.equal(await cache.version("counts"), before.counts);
  assert.notEqual(await cache.version("sessions"), before.sessions);
});

test("identical work arriving together runs one after another, never overlapping", async () => {
  const cache = new SharedCache(new MemoryBackend());
  let running = 0;
  let overlapped = false;
  const order: number[] = [];
  const job = (n: number) => cache.withLock("callback:abc", 5_000, async () => {
    running += 1;
    if (running > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push(n);
    running -= 1;
    return n;
  });
  const results = await Promise.all([job(1), job(2), job(3)]);
  assert.deepEqual(results.sort(), [1, 2, 3], "every one still runs: a lock adds order, not refusal");
  assert.equal(overlapped, false);
});

test("different keys do not wait for each other", async () => {
  const cache = new SharedCache(new MemoryBackend());
  const started = Date.now();
  await Promise.all([cache.withLock("a", 5_000, () => new Promise((r) => setTimeout(r, 60))), cache.withLock("b", 5_000, () => new Promise((r) => setTimeout(r, 60)))]);
  assert.ok(Date.now() - started < 110, "independent locks ran one after the other");
});

test("a lock nobody released lapses by itself, and a late release cannot free someone else's", async () => {
  const time = clock();
  const backend = new MemoryBackend(time.now);
  assert.equal(await backend.acquire("k", "first", 1_000), true);
  assert.equal(await backend.acquire("k", "second", 1_000), false);
  time.advance(1_001);
  assert.equal(await backend.acquire("k", "second", 1_000), true);
  await backend.release("k", "first");
  assert.equal(await backend.acquire("k", "third", 1_000), false, "the stale holder must not release the new lock");
});

test("work still runs when the lock cannot be had, whether Redis is down or the lock is stuck", async () => {
  const down = new SharedCache(broken("throw"));
  assert.equal(await down.withLock("k", 1_000, async () => "ran"), "ran");
  const backend = new MemoryBackend();
  await backend.acquire("hf:lock:stuck", "someone-else", 60_000);
  const stuck = new SharedCache(backend);
  const started = Date.now();
  assert.equal(await stuck.withLock("stuck", 1_000, async () => "ran anyway", 100), "ran anyway");
  assert.ok(Date.now() - started >= 90, "it should have waited its turn first");
});

test("the lock is released when the work throws", async () => {
  const backend = new MemoryBackend();
  const cache = new SharedCache(backend);
  await assert.rejects(cache.withLock("k", 5_000, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await backend.acquire("hf:lock:k", "next", 1_000), true);
});
