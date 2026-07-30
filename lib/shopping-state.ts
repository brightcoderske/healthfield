export const CART_COOKIE = "healthfield_cart";
export const WISHLIST_COOKIE = "healthfield_wishlist";

export function parseCart(value?: string) {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed)
      .map(([id, quantity]) => [Number(id), Math.min(99, Math.max(0, Number(quantity)))])
      .filter(([id, quantity]) => Number.isInteger(id) && id > 0 && Number.isInteger(quantity) && quantity > 0));
  } catch {
    return {} as Record<number, number>;
  }
}

export function parseWishlist(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown[];
    return [...new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
  } catch {
    return [] as number[];
  }
}
