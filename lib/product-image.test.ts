import assert from "node:assert/strict";
import test from "node:test";
import { productImageSources } from "./product-image.ts";

test("a stored picture offers its two small copies and keeps the original as the fallback", () => {
  const url = "https://www.healthfieldpharmacy.co.ke/uploads/products/8a7777d3-fdb9-4aba-af4f-fb869187f980.jpg";
  const sources = productImageSources(url);
  assert.equal(sources.src, url);
  assert.equal(
    sources.srcSet,
    "https://www.healthfieldpharmacy.co.ke/uploads/products/8a7777d3-fdb9-4aba-af4f-fb869187f980-400.webp 400w, https://www.healthfieldpharmacy.co.ke/uploads/products/8a7777d3-fdb9-4aba-af4f-fb869187f980-800.webp 800w",
  );
});

test("every stored format maps to the same copies, and a relative path keeps working", () => {
  for (const extension of ["jpg", "jpeg", "JPG", "png", "webp", "avif", "bmp", "tif", "tiff"]) {
    const sources = productImageSources(`/uploads/products/abc-123.${extension}`);
    assert.equal(sources.srcSet, "/uploads/products/abc-123-400.webp 400w, /uploads/products/abc-123-800.webp 800w", extension);
  }
});

test("pictures that are not ours, or may be animated, are left exactly as they are", () => {
  for (const url of ["https://cdn.example.com/photo.jpg", "/uploads/products/animated.gif", "/images/hero.png", "/uploads/products/folder/x.jpg"]) {
    assert.deepEqual(productImageSources(url), { src: url }, url);
  }
});
