export const CART_COOKIE = "healthfield_cart";
export const WISHLIST_COOKIE = "healthfield_wishlist";

/**
 * The cart cookie holds products and offer bundles separately:
 *   { "p": { "12": 2 }, "o": { "3": 1 } }
 *
 * Carts written before bundles existed are a flat product map, so that shape is
 * still read: an existing shopper does not lose their basket on deploy.
 */
type CartCookie = { p?: Record<string, unknown>; o?: Record<string, unknown> };

// A bundle is an all-or-nothing purchase, so only one of each may be held.
export const MAX_BUNDLES_PER_OFFER = 1;

function countMap(source: Record<string, unknown> | undefined, max: number) {
  if (!source) return {} as Record<number, number>;
  return Object.fromEntries(Object.entries(source)
    .map(([id, quantity]) => [Number(id), Math.min(max, Math.max(0, Math.floor(Number(quantity))))])
    .filter(([id, quantity]) => Number.isInteger(id) && id > 0 && Number.isInteger(quantity) && quantity > 0));
}

function readCookie(value?: string): CartCookie {
  try {
    const parsed = JSON.parse(value || "{}") as CartCookie & Record<string, unknown>;
    if (parsed && (parsed.p !== undefined || parsed.o !== undefined)) return parsed;
    return { p: parsed as Record<string, unknown> };
  } catch {
    return {};
  }
}

export function parseCart(value?: string) {
  return countMap(readCookie(value).p, 99);
}

export function parseCartOffers(value?: string) {
  return countMap(readCookie(value).o, MAX_BUNDLES_PER_OFFER);
}

export function serializeCart(products: Record<number, number>, offers: Record<number, number>) {
  return JSON.stringify({ p: products, o: offers });
}

export function parseWishlist(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown[];
    return [...new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
  } catch {
    return [] as number[];
  }
}
