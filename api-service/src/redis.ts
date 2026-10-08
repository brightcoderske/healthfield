import { Redis } from "ioredis";
import { SharedCache, type CacheBackend } from "./cache";

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

class RedisBackend implements CacheBackend {
  client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  /**
   * Waits out a connection that is still being made. The client is told to fail at once
   * rather than queue commands while disconnected (so a dead server never stalls a
   * request), which would also fail a command sent in the first moments after startup,
   * before the handshake has finished. A connection that is genuinely down is not waited
   * for: it fails straight away and the cache steps aside.
   */
  async ready(): Promise<void> {
    const client = this.client;
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

export async function closeSharedCache() {
  await client?.quit().catch(() => undefined);
}
