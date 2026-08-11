/**
 * Pure offer pricing rules. Deliberately free of database imports so the money
 * decisions can be tested directly.
 */

export type ResolvedOfferItem = {
  productId: number;
  name: string;
  imageUrl: string | null;
  quantity: number;
  normalPrice: number;
  offerPrice: number | null;
};

export type ResolvedOffer = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string | null;
  bundlePrice: number | null;
  items: ResolvedOfferItem[];
};

/** A group buy: several products sold together for one stated price. */
export const isBundle = (offer: ResolvedOffer) => offer.bundlePrice !== null && offer.items.length > 1;

/**
 * Per-product price overrides from live single-product offers. Bundles are excluded
 * deliberately: an administrator sets a bundle's overall price without disturbing
 * what each product costs on its own.
 *
 * Lowest wins when a product appears in more than one live offer, so a customer is
 * never charged above a price the site advertised.
 */
export function offerPriceMap(live: ResolvedOffer[]) {
  const map = new Map<number, number>();
  for (const offer of live) {
    if (isBundle(offer)) continue;
    for (const item of offer.items) {
      if (item.offerPrice === null) continue;
      const existing = map.get(item.productId);
      if (existing === undefined || item.offerPrice < existing) map.set(item.productId, item.offerPrice);
    }
  }
  return map;
}

/**
 * What a customer pays for the whole offer.
 *
 * A bundle charges its stated price. A single-product offer charges its own reduced
 * price — summing the normal prices here would advertise the offer at full price.
 */
export function offerTotal(offer: ResolvedOffer) {
  if (isBundle(offer)) return offer.bundlePrice as number;
  return offer.items.reduce((sum, item) => sum + (item.offerPrice ?? item.normalPrice) * item.quantity, 0);
}

/** What the offer would have cost at normal prices, for showing the saving. */
export function normalTotal(offer: ResolvedOffer) {
  return offer.items.reduce((sum, item) => sum + item.normalPrice * item.quantity, 0);
}

/**
 * Splits a bundle's price across its component products.
 *
 * Each component keeps its own order line so stock still moves per product, but the
 * customer is charged the bundle price and nothing else. Shares are weighted by what
 * each component would normally cost, and any rounding remainder lands on the largest
 * share, so the parts always add up to exactly the bundle price — never a cent over.
 *
 * Works in whole cents to keep the arithmetic exact.
 */
export function apportionBundle(totalCents: number, weights: number[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const total = Math.max(0, Math.round(totalCents));
  const sum = weights.reduce((running, weight) => running + Math.max(0, weight), 0);
  // With no usable weights (all zero), split as evenly as the cents allow.
  const shares = sum > 0
    ? weights.map((weight) => Math.floor((Math.max(0, weight) / sum) * total))
    : weights.map(() => Math.floor(total / count));
  let remainder = total - shares.reduce((running, share) => running + share, 0);
  // Hand the leftover cents out one at a time, biggest share first, so the
  // distribution stays stable and no line is left negative.
  const order = shares.map((share, index) => ({ share, index })).sort((left, right) => right.share - left.share || left.index - right.index);
  for (let step = 0; remainder > 0; step += 1, remainder -= 1) shares[order[step % count].index] += 1;
  return shares;
}

/** An offer is live only while switched on and inside its window. */
export function isLive(offer: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now = new Date()) {
  if (!offer.isActive) return false;
  if (offer.startsAt && offer.startsAt.getTime() > now.getTime()) return false;
  if (offer.endsAt && offer.endsAt.getTime() <= now.getTime()) return false;
  return true;
}
