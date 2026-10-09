/**
 * The shared cache: what the API remembers between requests, between restarts and between
 * workers.
 *
 * Redis is an optimisation here, never a dependency. Every operation fails open — if the
 * server is not configured, cannot be reached, or answers too slowly, a read is a miss, a
 * write is skipped, and the site behaves exactly as it did before Redis existed. After a
 * failure the cache stays out of the way for a short cooldown instead of making every
 * request wait on a server that is down.
 *
 * This file holds the logic only, with the storage behind a small interface, so it can be
 * tested without a Redis server. The Redis implementation lives in ./redis.
 *
 * Written without enums or constructor parameter properties: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Adds one to a counter, starting its expiry clock the first time it is created. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Takes a lock if nobody holds it. `token` identifies the holder; the lock lapses by itself. */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Releases a lock, but only if `token` still holds it, so a late release cannot free someone else's. */
  release(key: string, token: string): Promise<void>;
}

type Entry = { value: string; expiresAt: number };

/**
 * In-process storage. Used by tests, and as the fallback that keeps rate limiting working
 * (per worker, as before) when Redis is unavailable. Expired entries are swept as it is
 * used, so a long-running process does not grow without bound.
 */
export class MemoryBackend implements CacheBackend {
  entries: Map<string, Entry>;
  clock: () => number;
  operations: number;

  constructor(clock: () => number = Date.now) {
    this.entries = new Map();
    this.clock = clock;
    this.operations = 0;
  }

  sweep() {
    this.operations += 1;
    if (this.operations % 200 !== 0 && this.entries.size < 5000) return;
    const now = this.clock();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }

  async get(key: string) {
    this.sweep();
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.clock()) return null;
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.sweep();
    this.entries.set(key, { value, expiresAt: this.clock() + ttlSeconds * 1000 });
  }

  async increment(key: string, ttlSeconds: number) {
    this.sweep();
    const now = this.clock();
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.entries.set(key, { value: "1", expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }

  async acquire(key: string, token: string, ttlMs: number) {
    this.sweep();
    const now = this.clock();
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > now) return false;
    this.entries.set(key, { value: token, expiresAt: now + ttlMs });
    return true;
  }

  async release(key: string, token: string) {
    if (this.entries.get(key)?.value === token) this.entries.delete(key);
  }
}

export type CacheStatus = "disabled" | "up" | "down";

export type SharedCacheOptions = {
  /** Put in front of every key, so this site's keys cannot collide with anything else's. */
  prefix?: string;
  /** How long to leave a failing backend alone before trying it again. */
  failureCooldownMs?: number;
  /** The longest any single cache call may delay a request. */
  operationTimeoutMs?: number;
  /** How long this process trusts the catalogue version it last read. */
  versionTrustMs?: number;
  clock?: () => number;
  onError?: (error: unknown, operation: string) => void;
};

/**
 * Things whose cached copies can be made stale all at once by moving a version number that
 * is part of every key: the public pages ("catalogue"), signed-in sessions ("sessions") and
 * the counts shown on the admin screens ("counts").
 */
export type VersionNamespace = "catalogue" | "sessions" | "counts";

export class SharedCache {
  backend: CacheBackend | null;
  fallback: MemoryBackend;
  prefix: string;
  failureCooldownMs: number;
  operationTimeoutMs: number;
  versionTrustMs: number;
  clock: () => number;
  onError: (error: unknown, operation: string) => void;
  downUntil: number;
  inFlight: Map<string, Promise<unknown>>;
  versions: Map<VersionNamespace, { value: string; readAt: number }>;
  counters: { hits: number; misses: number; errors: number };

  constructor(backend: CacheBackend | null, options: SharedCacheOptions = {}) {
    this.backend = backend;
    this.clock = options.clock ?? Date.now;
    this.fallback = new MemoryBackend(this.clock);
    this.prefix = options.prefix ?? "hf:";
    this.failureCooldownMs = options.failureCooldownMs ?? 10_000;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 300;
    this.versionTrustMs = options.versionTrustMs ?? 1_000;
    this.onError = options.onError ?? (() => undefined);
    this.downUntil = 0;
    this.inFlight = new Map();
    this.versions = new Map();
    this.counters = { hits: 0, misses: 0, errors: 0 };
  }

  get status(): CacheStatus {
    if (!this.backend) return "disabled";
    return this.clock() < this.downUntil ? "down" : "up";
  }

  /** Runs one backend call under the time limit, and benches the backend if it fails. */
  async attempt<T>(operation: string, call: (backend: CacheBackend) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    const backend = this.backend;
    if (!backend || this.clock() < this.downUntil) return { ok: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        call(backend),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`cache ${operation} timed out`)), this.operationTimeoutMs);
        }),
      ]);
      return { ok: true, value };
    } catch (error) {
      this.counters.errors += 1;
      this.downUntil = this.clock() + this.failureCooldownMs;
      this.onError(error, operation);
      return { ok: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async get(key: string): Promise<string | null> {
    const result = await this.attempt("get", (backend) => backend.get(this.prefix + key));
    const value = result.ok ? result.value : null;
    if (value === null) this.counters.misses += 1;
    else this.counters.hits += 1;
    return value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.attempt("set", (backend) => backend.set(this.prefix + key, value, ttlSeconds));
  }

  /**
   * Returns the cached value, or builds it, stores it and returns it.
   *
   * Callers asking for the same missing key at the same moment share one build rather than
   * each running it — the usual way a cache expiring turns into a rush on the database.
   * `cacheable` says whether a freshly built value is fit to keep (an error response is
   * not); an unfit value is still handed back to everyone waiting on it, just not stored.
   */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    build: () => Promise<T>,
    cacheable: (value: T) => boolean = () => true,
  ): Promise<{ value: T; cached: boolean }> {
    const hit = await this.get(key);
    if (hit !== null) {
      try {
        return { value: JSON.parse(hit) as T, cached: true };
      } catch {
        // An unreadable entry is treated as absent and overwritten below.
      }
    }
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return { value: await pending, cached: false };
    const building = (async () => {
      const value = await build();
      if (cacheable(value)) await this.set(key, JSON.stringify(value), ttlSeconds);
      return value;
    })();
    this.inFlight.set(key, building);
    try {
      return { value: await building, cached: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Counts one attempt against `key` and reports whether it is over `maximum` for the
   * current window. Shared across workers and restarts when Redis is up; per process, as it
   * always was, when it is not — so a Redis outage never locks anyone out or lets
   * everything through.
   */
  async rateLimited(key: string, maximum: number, windowSeconds: number): Promise<boolean> {
    const result = await this.attempt("rate-limit", (backend) => backend.increment(`${this.prefix}rate:${key}`, windowSeconds));
    const count = result.ok ? result.value : await this.fallback.increment(`rate:${key}`, windowSeconds);
    return count > maximum;
  }

  /**
   * The current version of a namespace, which every cached entry in it is keyed by. Changing
   * it is how an edit makes all of them stale at once without hunting down each one. Each
   * process trusts what it read for a second, so an entry is not asked about its version on
   * every single request.
   */
  async version(namespace: VersionNamespace): Promise<string> {
    const now = this.clock();
    const known = this.versions.get(namespace);
    if (known && now - known.readAt < this.versionTrustMs) return known.value;
    const result = await this.attempt("version", (backend) => backend.get(`${this.prefix}${namespace}:version`));
    const value = result.ok && result.value ? result.value : "0";
    this.versions.set(namespace, { value, readAt: now });
    return value;
  }

  /** Marks everything cached in a namespace as out of date. */
  async bump(namespace: VersionNamespace): Promise<void> {
    const result = await this.attempt("bump", (backend) => backend.increment(`${this.prefix}${namespace}:version`, 60 * 60 * 24 * 30));
    // This process forgets what it knew either way, so its own next read is fresh.
    if (result.ok) this.versions.set(namespace, { value: String(result.value), readAt: this.clock() });
    else this.versions.delete(namespace);
  }

  catalogueVersion() {
    return this.version("catalogue");
  }

  bumpCatalogue() {
    return this.bump("catalogue");
  }

  /**
   * Runs `work` while holding a lock on `key`, so identical requests arriving together are
   * handled one after another instead of racing.
   *
   * This only ever adds order, never a refusal: if the lock cannot be had because Redis is
   * unavailable, or is still held after `waitMs`, the work runs anyway. Whatever correctness
   * the work needs must come from the database, as it already does.
   */
  async withLock<T>(key: string, ttlMs: number, work: () => Promise<T>, waitMs = 3_000): Promise<T> {
    const lockKey = `${this.prefix}lock:${key}`;
    const token = `${this.clock()}-${Math.random().toString(36).slice(2)}`;
    const giveUpAt = this.clock() + waitMs;
    let held = false;
    for (;;) {
      const result = await this.attempt("lock", (backend) => backend.acquire(lockKey, token, ttlMs));
      if (!result.ok) break;
      if (result.value) { held = true; break; }
      if (this.clock() >= giveUpAt) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    try {
      return await work();
    } finally {
      if (held) await this.attempt("unlock", (backend) => backend.release(lockKey, token));
    }
  }
}
