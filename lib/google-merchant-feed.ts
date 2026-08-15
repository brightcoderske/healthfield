export type MerchantProduct = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  discountPrice: string | null;
  brand: string | null;
  barcode: string | null;
  packSize: string | null;
  category: string;
  prescriptionRequired: boolean;
  rating: string | null;
  reviewCount: number;
};

export type MerchantFeedResult = {
  feed: string;
  sourceCount: number;
  itemCount: number;
  missingImageCount: number;
  invalidPriceCount: number;
};

function xml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function webUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function identifierFields(product: MerchantProduct) {
  const brand = product.brand?.trim();
  const sku = product.sku?.trim();
  const gtin = product.barcode?.replace(/[\s-]/g, "");

  if (gtin && /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) {
    return `${brand ? `<g:brand>${xml(brand)}</g:brand>` : ""}<g:gtin>${xml(gtin)}</g:gtin>`;
  }
  if (brand && sku) {
    return `<g:brand>${xml(brand)}</g:brand><g:mpn>${xml(sku)}</g:mpn>`;
  }
  return "<g:identifier_exists>no</g:identifier_exists>";
}

export function buildGoogleMerchantFeed(rows: MerchantProduct[], origin: string): MerchantFeedResult {
  const siteOrigin = origin.replace(/\/$/, "");
  let missingImageCount = 0;
  let invalidPriceCount = 0;
  const items: string[] = [];

  for (const product of rows) {
    const imageUrl = webUrl(product.imageUrl);
    if (!imageUrl) {
      missingImageCount += 1;
      continue;
    }

    const regularPrice = Number(product.price);
    if (!Number.isFinite(regularPrice) || regularPrice <= 0) {
      invalidPriceCount += 1;
      continue;
    }

    const possibleSalePrice = product.discountPrice === null ? null : Number(product.discountPrice);
    const salePrice = possibleSalePrice !== null && Number.isFinite(possibleSalePrice) && possibleSalePrice > 0 && possibleSalePrice < regularPrice
      ? possibleSalePrice
      : null;
    const fallbackDescription = `${product.name}${product.packSize ? ` - ${product.packSize}` : ""}, available from Healthfield Pharmacy.`;
    const title = richTextToPlainText(product.name).slice(0, 150);
    const description = (richTextToPlainText(product.description || "") || fallbackDescription).slice(0, 5000);
    const id = product.sku?.trim() || `hf-${product.id}`;
    const rating = product.rating === null ? null : Number(product.rating);
    const reviewFields = Number.isFinite(rating) && rating! > 0 && product.reviewCount > 0
      ? `<g:product_review_count>${product.reviewCount}</g:product_review_count><g:product_review_average>${rating!.toFixed(1)}</g:product_review_average>`
      : "";

    items.push(
      `<item><g:id>${xml(id)}</g:id><g:title>${xml(title)}</g:title><g:description>${xml(description)}</g:description>` +
      `<g:link>${xml(`${siteOrigin}/products/${product.id}`)}</g:link><g:image_link>${xml(imageUrl)}</g:image_link>` +
      `<g:availability>in_stock</g:availability><g:price>${regularPrice.toFixed(2)} KES</g:price>` +
      `${salePrice === null ? "" : `<g:sale_price>${salePrice.toFixed(2)} KES</g:sale_price>`}` +
      `<g:condition>new</g:condition>${identifierFields(product)}` +
      `<g:product_type>${xml(`Health & Beauty > ${product.category}`)}</g:product_type>${reviewFields}</item>`,
    );
  }

  const feed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Healthfield Pharmacy product feed</title><link>${xml(siteOrigin)}</link><description>Medicines, skincare, wellness and personal-care products from Healthfield Pharmacy.</description>${items.join("")}</channel></rss>`;
  return {
    feed,
    sourceCount: rows.length,
    itemCount: items.length,
    missingImageCount,
    invalidPriceCount,
  };
}
import { richTextToPlainText } from "./rich-text-content.ts";
