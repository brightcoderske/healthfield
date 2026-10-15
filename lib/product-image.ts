/**
 * Picture sources for a catalogue card.
 *
 * Every product picture stored by the API has two smaller WebP copies beside it, named
 * `<name>-400.webp` and `<name>-800.webp` (api-service/src/product-images.ts), and the API makes
 * a missing one on first request. Giving the browser both lets a phone take the small one and a
 * sharp laptop screen take the larger, rather than everyone downloading the full-size original.
 *
 * Anything that is not one of our own stored pictures (an external link, a GIF that may be
 * animated) is returned as it is, with no `srcSet`.
 */
const storedPicture = /^(.*\/uploads\/products\/[a-zA-Z0-9-]+)\.(?:jpe?g|png|webp|avif|bmp|tiff?)(?:\?.*)?$/i;

/** What the browser is told about how wide a card's picture will be, for the layouts the catalogue grid uses. */
export const PRODUCT_CARD_IMAGE_SIZES = "(max-width: 500px) 46vw, (max-width: 1179px) 24vw, 18vw";

export function productImageSources(url: string): { src: string; srcSet?: string } {
  const match = storedPicture.exec(url);
  if (!match) return { src: url };
  return { src: url, srcSet: `${match[1]}-400.webp 400w, ${match[1]}-800.webp 800w` };
}
