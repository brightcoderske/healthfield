export type OfferTeaserProduct = {
  productId: number;
  imageUrl: string | null;
  quantity: number;
};

export type OfferTileLayout = "one" | "two" | "three" | "four";

/**
 * Keeps the storefront card compact while making the number of included products
 * explicit. Items without artwork remain in the result so the UI can render a
 * placeholder rather than understating the bundle size.
 */
export function offerTilePresentation(items: OfferTeaserProduct[]) {
  const tiles = items.slice(0, 4);
  const layout: OfferTileLayout =
    tiles.length <= 1 ? "one" :
    tiles.length === 2 ? "two" :
    tiles.length === 3 ? "three" :
    "four";

  return {
    tiles,
    layout,
    remaining: Math.max(0, items.length - tiles.length),
  };
}
