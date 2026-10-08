import { Redis } from "ioredis";
import { SharedCache, type CacheBackend } from "./cache";
import { Outbox, type OutboxJob, type OutboxStorage } from "./outbox";

/**
 * Connects the shared cache to Redis, if the server has been told where it is.
 *
 *   REDIS_SOCKET      path of the Unix socket (cPanel: only this account can open it)
 *   REDIS_URL         redis://… instead, for a server reached over TCP
 *   REDIS_KEY_PREFIX  put in front of every key (default "hf:")
 *   REDIS_ENABLED     "false" switches it off without removing the settings
 *
 * With none of them set this is a no-op and the API behaves as it did before Redis, which
 * is what makes it safe to deploy first and switch on afterwards.
 */

// Adds one to a counter and starts its expiry clock only when the counter is created, in
// one step, so two requests arriving together cannot leave a counter that never expires.
const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

/**
 * Waits out a connection that is still being made. The client is told to fail at once
 * rather than queue commands while disconnected (so a dead server never stalls a request),
 * which would also fail a command sent in the first moments after startup, before the
 * handshake has finished. A connection that is genuinely down is not waited for: it fails
 * straight away and the cache steps aside.
 */
async function waitUntilReady(client: Redis): Promise<void> {
  if (client.status === "ready") return;
  if (!["wait", "connecting", "connect"].includes(client.status)) throw new Error(`Redis is ${client.status}`);
  if (client.status === "wait") void client.connect().catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("Redis did not become ready in time")), 250);
    const onReady = () => done();
    const onFail = () => done(new Error("Redis connection failed"));
    function done(error?: Error) {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("end", onFail);
      client.off("close", onFail);
      if (error) reject(error);
      else resolve();
    }
    client.once("ready", onReady);
    client.once("end", onFail);
    client.once("close", onFail);
  });
}

// Deletes a lock only if the caller still holds it, in one step.
const RELEASE_IF_HELD = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

class RedisBackend implements CacheBackend {
  client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  ready(): Promise<void> {
    return waitUntilReady(this.client);
  }

  async get(key: string) {
    await this.ready();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.ready();
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async increment(key: string, ttlSeconds: number) {
    await this.ready();
    return Number(await this.client.eval(INCREMENT_WITH_EXPIRY, 1, key, String(ttlSeconds)));
  }

  async acquire(key: string, token: string, ttlMs: number) {
    await this.ready();
    return (await this.client.set(key, token, "PX", ttlMs, "NX")) === "OK";
  }

  async release(key: string, token: string) {
    await this.ready();
    await this.client.eval(RELEASE_IF_HELD, 1, key, token);
  }
}

let lastLoggedAt = 0;
/** One line a minute at most: a Redis outage must not fill the log with one per request. */
function logOnce(error: unknown, operation: string) {
  const now = Date.now();
  if (now - lastLoggedAt < 60_000) return;
  lastLoggedAt = now;
  console.warn(`[cache] Redis ${operation} failed; carrying on without it for a few seconds.`, error instanceof Error ? error.message : error);
}

function createClient(): Redis | null {
  if (process.env.REDIS_ENABLED === "false") return null;
  const socket = (process.env.REDIS_SOCKET || "").trim();
  const url = (process.env.REDIS_URL || "").trim();
  if (!socket && !url) return null;
  const options = {
    lazyConnect: true,
    // Fail at once while disconnected instead of queueing commands behind a dead server.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    commandTimeout: 300,
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 5_000),
  };
  const connection = socket ? new Redis({ path: socket, ...options }) : new Redis(url, options);
  // Connection errors are already handled where the commands fail; this only stops the
  // client treating an unhandled "error" event as fatal.
  connection.on("error", (error) => logOnce(error, "connection"));
  void connection.connect().catch((error) => logOnce(error, "connect"));
  return connection;
}


// Hands out due jobs and pushes each one's due time forward by the lease, in one step, so two
// workers asking at once can never be given the same job.
const CLAIM_DUE_JOBS = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
for _, id in ipairs(ids) do redis.call('ZADD', KEYS[1], ARGV[2], id) end
return ids
`;

const JOB_KEEP_SECONDS = 7 * 24 * 60 * 60;
const FAILED_KEEP = 200;

/** The outbox's storage: a sorted set of when each job is due, and one key per job. */
class RedisOutboxStorage implements OutboxStorage {
  client: Redis;
  prefix: string;

  constructor(client: Redis, prefix: string) {
    this.client = client;
    this.prefix = prefix;
  }

  due() { return `${this.prefix}outbox:due`; }
  failedList() { return `${this.prefix}outbox:failed`; }
  jobKey(id: string) { return `${this.prefix}outbox:job:${id}`; }

  async add(job: OutboxJob, runAt: number) {
    await waitUntilReady(this.client);
    // The job is written before it is scheduled, so a worker never finds an id with no job.
    await this.client.multi().set(this.jobKey(job.id), JSON.stringify(job), "EX", JOB_KEEP_SECONDS).zadd(this.due(), runAt, job.id).exec();
  }

  async claim(now: number, leaseMs: number, limit: number) {
    await waitUntilReady(this.client);
    const ids = (await this.client.eval(CLAIM_DUE_JOBS, 1, this.due(), String(now), String(now + leaseMs), String(limit))) as string[];
    if (!ids.length) return [];
    const bodies = await this.client.mget(ids.map((id) => this.jobKey(id)));
    const jobs: OutboxJob[] = [];
    const orphaned: string[] = [];
    bodies.forEach((body, index) => {
      try {
        if (body) jobs.push(JSON.parse(body) as OutboxJob);
        else orphaned.push(ids[index]);
      } catch {
        orphaned.push(ids[index]);
      }
    });
    // A scheduled id whose job is gone (expired, or evicted under memory pressure) is cleared.
    if (orphaned.length) await this.client.zrem(this.due(), ...orphaned);
    return jobs;
  }

  async complete(job: OutboxJob) {
    await waitUntilReady(this.client);
    await this.client.multi().zrem(this.due(), job.id).del(this.jobKey(job.id)).exec();
  }

  async reschedule(job: OutboxJob, runAt: number) {
    await waitUntilReady(this.client);
    await this.client.multi().set(this.jobKey(job.id), JSON.stringify(job), "EX", JOB_KEEP_SECONDS).zadd(this.due(), runAt, job.id).exec();
  }

  async fail(job: OutboxJob, reason: string, at: number) {
    await waitUntilReady(this.client);
    await this.client.multi()
      .zrem(this.due(), job.id)
      .del(this.jobKey(job.id))
      .lpush(this.failedList(), JSON.stringify({ job, reason, at }))
      .ltrim(this.failedList(), 0, FAILED_KEEP - 1)
      .exec();
  }

  async counts() {
    await waitUntilReady(this.client);
    const [queued, failed] = await Promise.all([this.client.zcard(this.due()), this.client.llen(this.failedList())]);
    return { queued, failed };
  }
}

// Built on first use, not at import: the API loads its .env file after its modules are
// evaluated, so reading the settings any earlier would find none of them.
let client: Redis | null = null;
let cache: SharedCache | null = null;

export function getSharedCache() {
  if (!cache) {
    client = createClient();
    cache = new SharedCache(client ? new RedisBackend(client) : null, {
      prefix: process.env.REDIS_KEY_PREFIX || "hf:",
      onError: logOnce,
    });
  }
  return cache;
}

let outbox: Outbox | null = null;

/**
 * The outbox, wired to Redis when it is configured and enabled. Its senders are supplied by
 * ./outbox-delivery (which knows about email and SMS) so this file stays about Redis.
 */
export function getOutbox(senders: ConstructorParameters<typeof Outbox>[1] = {}) {
  if (!outbox) {
    getSharedCache();
    const enabled = client && process.env.OUTBOX_ENABLED !== "false";
    const retrySeconds = (process.env.OUTBOX_RETRY_SECONDS || "")
      .split(",")
      .map((value) => Number(value.trim()) * 1000)
      .filter((value) => Number.isFinite(value) && value > 0);
    outbox = new Outbox(enabled && client ? new RedisOutboxStorage(client, process.env.REDIS_KEY_PREFIX || "hf:") : null, senders, {
      retryDelaysMs: retrySeconds.length ? retrySeconds : undefined,
      log: (message, detail) => console.warn(`[outbox] ${message}`, detail ?? ""),
    });
  } else if (Object.keys(senders).length) {
    outbox.senders = { ...outbox.senders, ...senders };
  }
  return outbox;
}

export async function closeSharedCache() {
  outbox?.stop();
  await client?.quit().catch(() => undefined);
}
