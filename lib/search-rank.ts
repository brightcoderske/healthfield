/**
 * How well a product matches what was typed into search.
 *
 * Search used to return products featured-first then newest, whatever part of the product
 * the words matched — so a product that only mentioned "water" somewhere in its
 * description could sit above one called "Water". A shopper types a product's name far
 * more often than a phrase from its description, so matches on the name lead, and the
 * closer the name is to what was typed, the higher it sits.
 *
 * Lower is better:
 *   0  the name starts with exactly what was typed      "water" -> "Water for injection"
 *   1  every word typed starts a word in the name       "water" -> "Rose Water Toner"
 *   2  every word typed appears in the name             "water" -> "Saltwater rinse"
 *   3  some of the words typed appear in the name
 *   4  the brand holds every word typed
 *   5  anything else — description, category
 *
 * The server orders its results by the same rules (see the search view), so the order
 * does not change when the full results arrive after the instant local ones.
 */

export type SearchRankable = {
  name: string;
  brand?: string | null;
};

function queryWords(query: string) {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);
}

/** The whole typed phrase, single letters included — what "starts with" is tested against. */
export function searchPhrase(query: string) {
  return queryWords(query).join(" ");
}

/** The words of a query, the way search reads them: lower case, punctuation dropped. */
export function searchQueryTerms(query: string) {
  const words = queryWords(query);
  // Single letters add noise to a longer query, but a query of nothing else still counts.
  const meaningful = words.filter((word) => word.length > 1);
  return (meaningful.length ? meaningful : words).slice(0, 6);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function searchRank(product: SearchRankable, query: string) {
  const terms = searchQueryTerms(query);
  if (!terms.length) return 5;
  const name = (product.name || "").toLowerCase();
  // The whole phrase keeps its single letters: "vitamin c" should put Vitamin C above
  // Vitamin E, even though "c" on its own is too short to search by.
  const phrase = searchPhrase(query);
  if (name.startsWith(phrase)) return 0;
  const startsWord = (term: string) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}`, "u").test(name);
  if (terms.every(startsWord)) return 1;
  if (terms.every((term) => name.includes(term))) return 2;
  if (terms.some((term) => name.includes(term))) return 3;
  const brand = (product.brand || "").toLowerCase();
  if (brand && terms.every((term) => brand.includes(term))) return 4;
  return 5;
}

/**
 * Orders search results best match first. Stable: products that match equally well keep
 * the order they arrived in, which is the server's featured-then-newest order.
 */
export function rankSearchResults<T extends SearchRankable>(products: T[], query: string) {
  return products
    .map((product, index) => ({ product, index, rank: searchRank(product, query) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.product);
}
