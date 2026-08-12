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
  id: number; title: string; description: string | null; total: number; normalTotal: number;
  isBundle: boolean; itemCount: number; imageUrl: string | null; endsAt: string | null;
};
export type BreakGuide = { id: number; slug: string; title: string; excerpt: string; imageUrl: string | null };

export type BreakItem =
  // Each collection carries its lead item first plus the rest, so a wide screen can
  // slide through several rather than stretching one card across the whole row.
  | { kind: "offer"; offer: BreakOffer; offers: BreakOffer[] }
  | { kind: "guide"; guide: BreakGuide; guides: BreakGuide[] };

export const INTERRUPTION_EVERY = 10;
export const MIN_PRODUCTS_BEFORE_BREAK = 3;

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
 * Where to break the scroll.
 *
 * The gaps deliberately vary rather than landing on a fixed drumbeat: sometimes a
 * row or two of products then a card, sometimes a longer run. An even rhythm reads
 * as advertising furniture; an uneven one reads like part of the page.
 *
 * The base gap scales with catalogue size — a small pharmacy still gets its offers
 * seen, a large one is not peppered with cards — and each gap is then jittered by
 * the seed, so two visits lay out differently.
 *
 * A shopper who is searching or filtering has intent, so they get at most one
 * interruption: derailing a deliberate search is worse than a missed impression.
 */
export function breakPositions(count: number, { focused = false, random }: { focused?: boolean; random?: () => number } = {}) {
  if (count < MIN_PRODUCTS_BEFORE_BREAK * 2) return [];
  const base = Math.min(INTERRUPTION_EVERY, Math.max(MIN_PRODUCTS_BEFORE_BREAK, Math.floor(count / 2)));
  const positions: number[] = [];
  let at = 0;
  while (true) {
    // Jitter each gap by ±40% of the base, never below the minimum run of products.
    const spread = random ? 0.6 + random() * 0.8 : 1;
    const gap = Math.max(MIN_PRODUCTS_BEFORE_BREAK, Math.round(base * spread));
    at += gap;
    // Never break so late that a lone product trails the card.
    if (at >= count - 1) break;
    positions.push(at);
    if (focused) break;
  }
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
  seed: number;
  focused?: boolean;
  now?: number;
}) {
  const { products, offers, guides, seed, focused = false, now = Date.now() } = input;
  const random = seededRandom(seed);
  const positions = breakPositions(products.length, { focused, random });
  if (!positions.length) return [] as Array<{ position: number; item: BreakItem }>;

  const context = products.slice(0, 12).flatMap((product) => product.name.toLowerCase().split(/\s+/));
  const rankedOffers = rankOffers(offers, random, now);
  const rankedGuides = rankGuides(guides, context, random);

  const kinds: Array<"offer" | "guide"> = [];
  if (rankedOffers.length) kinds.push("offer");
  if (rankedGuides.length) kinds.push("guide");
  // No live offer or published guide means no interruption. This explicit guard
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
  });
  return plan;
}
