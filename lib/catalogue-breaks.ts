import type { OfferTeaserProduct } from "./offer-teaser";

/**
 * Decides what interrupts the catalogue scroll, and where.
 *
 * Kept pure and dependency-free so the selection rules can be tested directly.
 *
 * On randomness: the variation is *seeded*, never `Math.random()`. The storefront is
 * server-rendered and then hydrated, so an unseeded shuffle would produce different
 * markup on each side and break hydration. The server mints one seed per request and
 * passes it down, which gives a different arrangement on every visit while both
 * renders agree.
 */

export type BreakProduct = {
  id: number; name: string;
};
export type BreakOffer = {
  id: number; title: string; slug: string; description: string | null; total: number; normalTotal: number;
  isBundle: boolean; itemCount: number; imageUrl: string | null; endsAt: string | null; items: OfferTeaserProduct[];
};
export type BreakGuide = { id: number; slug: string; title: string; excerpt: string; imageUrl: string | null };
export type BreakPromotion = { id: number; title: string; imageUrl: string; productId: number; productName: string };

export type BreakItem =
  // Each collection carries its lead item first plus the rest, so a wide screen can
  // slide through several rather than stretching one card across the whole row.
  | { kind: "offer"; offer: BreakOffer; offers: BreakOffer[] }
  | { kind: "guide"; guide: BreakGuide; guides: BreakGuide[] }
  | { kind: "promotion"; promotion: BreakPromotion; promotions: BreakPromotion[] };

/** Rows of products between one interruption and the next, on every screen size. */
export const ROWS_BETWEEN_BREAKS = 2;

/** Small deterministic PRNG (mulberry32). Same seed, same sequence, every time. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Where to break the scroll: after every two full rows of products, on every screen.
 *
 * The gap is counted in rows, not products, because what a shopper feels is how far they
 * scroll. A gap of ten products is two rows on a laptop but five on a phone. The caller
 * passes the number of columns the grid is showing, so a phone (2 columns) breaks after
 * 4 products and a wide laptop (5 columns) after 10. The rhythm is fixed on purpose:
 * nothing here depends on the seed, on what the shopper searched for, or on how many
 * products have loaded, so no input can stretch the gap or switch the breaks off.
 *
 * A position is the index of the product the card sits in front of, so a card is only
 * placed when at least one product follows it.
 */
export function breakPositions(count: number, columns: number) {
  const perBreak = Math.max(1, Math.floor(columns)) * ROWS_BETWEEN_BREAKS;
  const positions: number[] = [];
  for (let at = perBreak; at < count; at += perBreak) positions.push(at);
  return positions;
}

const millisecondsPerDay = 86_400_000;

/** Offers closest to expiry lead; ties are broken by the seed so it is not always the same one. */
function rankOffers(offers: BreakOffer[], random: () => number, now: number) {
  const urgency = (offer: BreakOffer) => {
    if (!offer.endsAt) return Number.POSITIVE_INFINITY;
    return (new Date(offer.endsAt).getTime() - now) / millisecondsPerDay;
  };
  return shuffled(offers, random)
    .map((offer) => ({ offer, days: urgency(offer) }))
    // Group by whole days so several offers ending the same week stay shuffled
    // rather than locking to a fixed order.
    .sort((left, right) => Math.floor(left.days) - Math.floor(right.days))
    .map((entry) => entry.offer);
}

/** A guide that mentions something on screen beats one that does not. */
function rankGuides(guides: BreakGuide[], context: string[], random: () => number) {
  const score = (guide: BreakGuide) => {
    const text = `${guide.title} ${guide.excerpt}`.toLowerCase();
    return context.reduce((hits, term) => (term.length > 3 && text.includes(term) ? hits + 1 : hits), 0);
  };
  return shuffled(guides, random).sort((left, right) => score(right) - score(left));
}

/**
 * Builds the full plan: which card sits at which position.
 *
 * Kinds rotate so two neighbouring breaks are never the same type, and only kinds
 * with content behind them take part.
 */
export function planBreaks(input: {
  products: BreakProduct[];
  offers: BreakOffer[];
  guides: BreakGuide[];
  promotions?: BreakPromotion[];
  seed: number;
  /** Columns the product grid is showing, so a break lands after two full rows. */
  columns: number;
  now?: number;
}) {
  const { products, offers, guides, promotions = [], seed, columns, now = Date.now() } = input;
  const random = seededRandom(seed);
  const positions = breakPositions(products.length, columns);
  if (!positions.length) return [] as Array<{ position: number; item: BreakItem }>;

  const context = products.slice(0, 12).flatMap((product) => product.name.toLowerCase().split(/\s+/));
  const rankedOffers = rankOffers(offers, random, now);
  const rankedGuides = rankGuides(guides, context, random);
  const rankedPromotions = shuffled(promotions, random);

  const kinds: Array<"offer" | "guide" | "promotion"> = [];
  if (rankedOffers.length) kinds.push("offer");
  if (rankedGuides.length) kinds.push("guide");
  if (rankedPromotions.length) kinds.push("promotion");
  // No live offer, published guide, or active promotion means no interruption. This explicit guard
  // keeps the seeded rotation from indexing an empty list and prevents any fallback
  // to the removed product-recommendation card.
  if (!kinds.length) return [] as Array<{ position: number; item: BreakItem }>;
  // Start the rotation at a seeded point so the first card is not always an offer.
  const start = Math.floor(random() * kinds.length);

  const plan: Array<{ position: number; item: BreakItem }> = [];
  // Each kind walks its own ranked list. Indexing by slot number instead would mean
  // the best-ranked offer or guide is only shown first by coincidence.
  let offerCursor = 0;
  let guideCursor = 0;
  let promotionCursor = 0;
  positions.forEach((position, index) => {
    const kind = kinds[(start + index) % kinds.length];
    if (kind === "offer") {
      // Rotate so each offer break leads with a different offer, and hand over the
      // rest in the same order for the slider on wider screens.
      const start = offerCursor % rankedOffers.length;
      const rotated = [...rankedOffers.slice(start), ...rankedOffers.slice(0, start)];
      plan.push({ position, item: { kind: "offer", offer: rotated[0], offers: rotated } });
      offerCursor += 1;
      return;
    }
    if (kind === "guide") {
      const start = guideCursor % rankedGuides.length;
      const rotated = [...rankedGuides.slice(start), ...rankedGuides.slice(0, start)];
      plan.push({ position, item: { kind: "guide", guide: rotated[0], guides: rotated } });
      guideCursor += 1;
      return;
    }
    const promotionStart = promotionCursor % rankedPromotions.length;
    const rotated = [...rankedPromotions.slice(promotionStart), ...rankedPromotions.slice(0, promotionStart)];
    plan.push({ position, item: { kind: "promotion", promotion: rotated[0], promotions: rotated } });
    promotionCursor += 1;
  });
  return plan;
}
