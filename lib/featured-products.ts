import { seededRandom } from "./catalogue-breaks.ts";

/**
 * The featured shelf and the homepage draw.
 *
 * Featuring used to be an open-ended flag, so the storefront's "featured first"
 * ordering quietly became "whatever was starred over the years, newest first" and the
 * same products led the homepage on every visit. Two rules fix that, and both live
 * here so they can be tested without a database or a browser:
 *
 *  - the shelf holds at most FEATURED_LIMIT products, and starring one more pushes off
 *    the one that has been featured the longest;
 *  - the storefront shows only FEATURED_VISIBLE of them at a time and rotates through
 *    the rest, so a long shelf still gives every product its turn without crowding
 *    the page.
 *
 * The shuffling is seeded rather than `Math.random()`, for the reason set out in
 * catalogue-breaks: the storefront is server-rendered then hydrated, and the two
 * renders have to agree on the order.
 */

export const FEATURED_LIMIT = 30;
/** How many featured products the storefront shows at once; the rest wait their turn. */
export const FEATURED_VISIBLE = 10;

export type FeaturedRow = { id: number; featuredAt?: Date | string | null };

/** Oldest featured first. A row with no recorded moment counts as the oldest of all. */
function byAgeFeatured(left: FeaturedRow, right: FeaturedRow) {
  const at = (row: FeaturedRow) => {
    if (!row.featuredAt) return 0;
    const value = new Date(row.featuredAt).getTime();
    // A zero date read back from a database that never stored one is not a moment.
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const difference = at(left) - at(right);
  return difference !== 0 ? difference : left.id - right.id;
}

/**
 * Which products have to give up their star so `incoming` can take one.
 *
 * Returns the ids to unfeature, oldest first. Empty when there is room, or when the
 * product is already on the shelf — re-saving a featured product must not evict
 * anything, least of all itself.
 */
export function featuredEvictions(current: FeaturedRow[], incomingId: number | null) {
  const shelf = current.filter((row) => row.id !== incomingId).sort(byAgeFeatured);
  const room = incomingId === null ? FEATURED_LIMIT : FEATURED_LIMIT - 1;
  const excess = shelf.length - room;
  return excess > 0 ? shelf.slice(0, excess).map((row) => row.id) : [];
}

/**
 * The featured products on screen at `step`.
 *
 * The shelf is dealt out `visible` at a time and wraps round, so every product gets the
 * same airtime whatever the shelf size. When the last batch is short it is topped up from
 * the front rather than left ragged, which keeps the rail full on every step. A shelf that
 * fits on one screen does not rotate at all.
 */
export function featuredWindow<T>(pool: T[], step: number, visible = FEATURED_VISIBLE) {
  if (pool.length <= visible) return pool;
  const start = ((step * visible) % pool.length + pool.length) % pool.length;
  return Array.from({ length: visible }, (_, index) => pool[(start + index) % pool.length]);
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
 * Lays out the homepage grid for one visit.
 *
 * Featured products lead — that is what featuring is for — but in a different order
 * each time, so the shelf itself does not read as a frozen banner. Everything after
 * them is the rest of the catalogue shuffled, which is what stops a visitor seeing the
 * same twenty tiles they saw yesterday.
 */
export function homeCatalogueOrder<T extends { id: number; isFeatured?: boolean }>(
  catalog: T[],
  seed: number,
) {
  const random = seededRandom(seed);
  const featured = shuffled(catalog.filter((product) => product.isFeatured), random);
  const rest = shuffled(catalog.filter((product) => !product.isFeatured), random);
  return [...featured, ...rest];
}
