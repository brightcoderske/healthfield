import type { SharedCache } from "./cache";

/**
 * Which API responses are safe to remember, for how long, and which edits make them stale.
 *
 * Only the public, anonymous views are cached — the pages anyone can open, which are the
 * bulk of the traffic and cost the most to build. Anything tied to a signed-in person
 * (accounts, orders, the admin screens) is deliberately not on this list.
 *
 * Staleness is handled two ways at once: every entry expires on its own after a short
 * time, and every change to the catalogue moves a version number that is part of each
 * key, so the old entries are simply never asked for again.
 *
 * Pure and free of imports, so the rules can be tested without a server.
 */

/** Seconds a public view may be served from the cache, or 0 for "never cache this". */
export function publicViewTtlSeconds(view: string): number {
  if (view === "home" || view === "browse" || view === "search") return 60;
  if (/^products\/\d+$/.test(view)) return 60;
  if (view === "blogs" || /^blogs\/[^/]+$/.test(view)) return 120;
  if (view === "locations" || view === "conditions") return 300;
  if (view === "sitemap" || view === "merchant") return 300;
  return 0;
}

/** Longest search string worth caching; beyond it, someone is probing rather than shopping. */
const MAX_QUERY_LENGTH = 300;
/** Largest response worth holding, in characters. */
export const MAX_CACHED_BODY = 1_500_000;

/**
 * The key for one view at one catalogue version, or null when the request should skip the
 * cache. The query string is put in a fixed order, and search words are folded to lower
 * case, so the same request written two ways shares one entry.
 */
export function viewCacheKey(version: string, view: string, search: string): string | null {
  if (search.length > MAX_QUERY_LENGTH) return null;
  const params = new URLSearchParams(search);
  const ordered = [...params.entries()]
    .map(([name, value]) => [name, name === "q" ? value.trim().toLowerCase().replace(/\s+/g, " ") : value] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const query = new URLSearchParams(ordered as unknown as string[][]).toString();
  return `view:${version}:${view}${query ? `?${query}` : ""}`;
}

const CATALOGUE_AREAS = /^\/v1\/(products|categories|conditions|offers|promotional-banners|blogs|settings|stores)(\/|$)/;

/** Whether a finished request changed what the public views show. */
export function changesCatalogue(method: string, pathname: string, status: number): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (status >= 400) return false;
  return CATALOGUE_AREAS.test(pathname);
}

const SESSION_AREAS = /^\/v1\/(auth\/(logout|change-password|reset-password)|staff)(\/|$)/;

/**
 * Whether a finished request could have changed who is allowed to do what: signing out,
 * changing or resetting a password, or anything done to a staff account (suspending,
 * deleting, changing its role, branch or permissions).
 */
export function changesSessions(method: string, pathname: string, status: number): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (status >= 400) return false;
  return SESSION_AREAS.test(pathname);
}

const COUNT_AREAS = /^\/v1\/(orders|prescriptions|consultations|chats|payments|walk-in-sales|pos)(\/|$)/;

/**
 * Whether a finished request could have changed a number shown on an admin badge. Includes
 * the payment callbacks, which is how a till payment that matches no order appears.
 */
export function changesCounts(method: string, pathname: string, status: number): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (status >= 400) return false;
  return COUNT_AREAS.test(pathname);
}

/** What is stored for a cached view: only what a client needs to be answered the same way. */
export type StoredView = { status: number; contentType: string; cacheControl: string | null; body: string };

/**
 * Answers a public view from the cache when it can, and builds it once when it cannot.
 *
 * A response that is not a plain success is never kept, and neither is one too large to be
 * worth holding. `X-Cache` says which happened, which is how a hit rate can be seen from
 * outside without any tooling.
 */
export async function serveCachedView(
  cache: SharedCache,
  view: string,
  search: string,
  build: () => Promise<Response>,
): Promise<Response> {
  const ttl = publicViewTtlSeconds(view);
  const key = ttl ? viewCacheKey(await cache.catalogueVersion(), view, search) : null;
  if (!ttl || !key || cache.status === "disabled") return build();
  const { value, cached } = await cache.remember<StoredView>(
    key,
    ttl,
    async () => {
      const response = await build();
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "application/json",
        cacheControl: response.headers.get("cache-control"),
        body: await response.text(),
      };
    },
    (stored) => stored.status === 200 && stored.body.length <= MAX_CACHED_BODY,
  );
  const headers = new Headers({ "Content-Type": value.contentType, "X-Cache": cached ? "HIT" : "MISS" });
  if (value.cacheControl) headers.set("Cache-Control", value.cacheControl);
  return new Response(value.body, { status: value.status, headers });
}
