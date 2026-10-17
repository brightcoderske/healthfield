/**
 * What the storefront keeps in the address bar: the search (?q=), the category (?category=<slug>)
 * and the condition (?condition=<slug>). Kept pure so the rules can be tested without a browser.
 *
 * The address bar, not the props the server rendered with, is what the page trusts when it starts.
 * Pressing Back from a product brings this page back from the browser's memory, with the props it
 * was first built with (no search, no filter), while the address bar already says what the
 * shopper had been looking at. Reading the props there is what used to send people home.
 */
type Named = { id: number; slug: string };

export type StorefrontFilters = { query: string; categoryId: number | null; conditionId: number | null };

/** The filters a URL's query string describes. An unknown slug means no filter, never an error. */
export function readStorefrontFilters(search: string, categories: Named[], conditions: Named[]): StorefrontFilters {
  const params = new URLSearchParams(search);
  const category = params.get("category");
  const condition = params.get("condition");
  return {
    query: params.get("q") ?? "",
    categoryId: category ? (categories.find((item) => item.slug === category)?.id ?? null) : null,
    conditionId: condition ? (conditions.find((item) => item.slug === condition)?.id ?? null) : null,
  };
}

/**
 * The query string (without the leading "?") for the filters now in force. Anything else already in
 * it, such as ?offers=1, is kept exactly as it was.
 */
export function writeStorefrontFilters(
  search: string,
  filters: { query: string; categorySlug: string | null; conditionSlug: string | null },
) {
  const params = new URLSearchParams(search);
  const apply = (key: string, value: string | null) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };
  apply("q", filters.query.trim() || null);
  apply("category", filters.categorySlug);
  apply("condition", filters.conditionSlug);
  return params.toString();
}
