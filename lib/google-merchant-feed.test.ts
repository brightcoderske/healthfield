import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMerchantFeed, type MerchantProduct } from "./google-merchant-feed.ts";

function product(id: number, overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id,
    sku: `HF-${id}`,
    name: `Product ${id}`,
    description: `<p>Useful &amp; genuine product ${id}</p>`,
    imageUrl: `https://api.healthfieldpharmacy.co.ke/uploads/product-${id}.webp`,
    price: "250.00",
    discountPrice: null,
    brand: "Healthfield",
    barcode: null,
    packSize: "1 pack",
    category: "Wellness",
    prescriptionRequired: false,
    rating: null,
    reviewCount: 0,
    ...overrides,
  };
}

test("the Merchant feed includes the full catalogue and does not stop at 50", () => {
  const rows = Array.from({ length: 73 }, (_, index) => product(index + 1, {
    prescriptionRequired: index % 3 === 0,
    category: index % 3 === 0 ? "Prescription Medicines" : "Wellness",
  }));
  const result = buildGoogleMerchantFeed(rows, "https://healthfieldpharmacy.co.ke");

  assert.equal(result.sourceCount, 73);
  assert.equal(result.itemCount, 73);
  assert.equal(result.feed.match(/<item>/g)?.length, 73);
  assert.match(result.feed, /<g:id>HF-73<\/g:id>/);
});

test("only products missing Google-required data are omitted and counted", () => {
  const result = buildGoogleMerchantFeed([
    product(1),
    product(2, { imageUrl: null }),
    product(3, { price: "0.00" }),
  ], "https://healthfieldpharmacy.co.ke/");

  assert.equal(result.sourceCount, 3);
  assert.equal(result.itemCount, 1);
  assert.equal(result.missingImageCount, 1);
  assert.equal(result.invalidPriceCount, 1);
});

test("feed content is plain text XML and does not contradict supplied identifiers", () => {
  const result = buildGoogleMerchantFeed([
    product(1, { description: "<p>Fast <strong>relief</strong> &amp; care</p>", discountPrice: "199.00" }),
    product(2, { barcode: "12345678" }),
  ], "https://healthfieldpharmacy.co.ke");

  assert.doesNotMatch(result.feed, /&lt;p&gt;|&lt;strong&gt;/);
  assert.match(result.feed, /Fast relief &amp; care/);
  assert.match(result.feed, /<g:price>250.00 KES<\/g:price><g:sale_price>199.00 KES<\/g:sale_price>/);
  assert.match(result.feed, /<g:brand>Healthfield<\/g:brand><g:mpn>HF-1<\/g:mpn>/);
  assert.match(result.feed, /<g:gtin>12345678<\/g:gtin>/);
  assert.doesNotMatch(result.feed, /<g:identifier_exists>no<\/g:identifier_exists>/);
});
