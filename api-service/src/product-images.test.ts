import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ensureProductImageSize, originalForProductImageSize, parseSizedProductImage, writeProductImageSizes } from "./product-images.ts";

async function sample(width = 1200, height = 1200) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 120 } } }).jpeg({ quality: 90 }).toBuffer();
}
async function folder() {
  return mkdtemp(path.join(tmpdir(), "product-images-"));
}

test("only the two size names are recognised", () => {
  assert.deepEqual(parseSizedProductImage("abc-123-400.webp"), { base: "abc-123", width: 400 });
  assert.deepEqual(parseSizedProductImage("abc-123-800.WEBP"), { base: "abc-123", width: 800 });
  for (const name of ["abc-123.webp", "abc-123-500.webp", "abc-123-400.jpg", "../abc-400.webp", "abc-400.webp.tmp"]) assert.equal(parseSizedProductImage(name), null, name);
});

test("an upload gets a 400 and an 800 WebP, smaller than the original", async () => {
  const directory = await folder();
  try {
    const original = await sample();
    await writeFile(path.join(directory, "pic-1.jpg"), original);
    await writeProductImageSizes(directory, "pic-1.jpg", original);
    for (const width of [400, 800]) {
      const bytes = await readFile(path.join(directory, `pic-1-${width}.webp`));
      const info = await sharp(bytes).metadata();
      assert.equal(info.format, "webp");
      assert.equal(info.width, width);
      assert.ok(bytes.length < original.length, `${width}px copy should be smaller than the original`);
    }
    assert.deepEqual((await readdir(directory)).sort(), ["pic-1-400.webp", "pic-1-800.webp", "pic-1.jpg"], "no temporary files are left behind");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a small original is never enlarged", async () => {
  const directory = await folder();
  try {
    const original = await sample(300, 200);
    await writeFile(path.join(directory, "small.jpg"), original);
    await writeProductImageSizes(directory, "small.jpg", original);
    const info = await sharp(await readFile(path.join(directory, "small-800.webp"))).metadata();
    assert.equal(info.width, 300);
    assert.equal(info.height, 200);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a picture uploaded before the copies existed gets its copy on first request, and keeps it", async () => {
  const directory = await folder();
  try {
    await writeFile(path.join(directory, "old.png"), await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png().toBuffer());
    const first = await ensureProductImageSize(directory, "old-400.webp");
    assert.ok(first);
    assert.equal((await sharp(first).metadata()).width, 400);
    assert.equal((await sharp(first).metadata()).hasAlpha, true, "transparency survives the conversion");
    assert.deepEqual(await readFile(path.join(directory, "old-400.webp")), first, "the copy is stored for next time");
    assert.deepEqual(await ensureProductImageSize(directory, "old-400.webp"), first);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("many requests for the same missing copy share one conversion", async () => {
  const directory = await folder();
  try {
    await writeFile(path.join(directory, "busy.jpg"), await sample());
    const results = await Promise.all(Array.from({ length: 12 }, () => ensureProductImageSize(directory, "busy-800.webp")));
    assert.ok(results.every((bytes) => bytes && bytes.equals(results[0]!)));
    assert.deepEqual((await readdir(directory)).sort(), ["busy-800.webp", "busy.jpg"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("no original, or an original that cannot be read, means no copy, so the caller can fall back", async () => {
  const directory = await folder();
  try {
    assert.equal(await ensureProductImageSize(directory, "ghost-400.webp"), null);
    await writeFile(path.join(directory, "broken.jpg"), Buffer.from("this is not an image"));
    assert.equal(await ensureProductImageSize(directory, "broken-400.webp"), null);
    // The original is still there to be shown instead.
    const original = await originalForProductImageSize(directory, "broken-400.webp");
    assert.equal(original?.extension, ".jpg");
    assert.equal(await originalForProductImageSize(directory, "ghost-400.webp"), null);
    assert.deepEqual((await readdir(directory)).sort(), ["broken.jpg"], "a failed conversion leaves nothing behind");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
