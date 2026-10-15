import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Smaller copies of each product picture, so a catalogue card downloads about 20 KB instead of
 * the original's 200 KB or more.
 *
 * A copy lives beside its original as `<name>-400.webp` or `<name>-800.webp`, so the same
 * `/uploads/products/<file>` route serves it and nothing about the URLs needs registering.
 * New uploads get both copies straight away. Pictures uploaded before this existed get theirs
 * the first time a browser asks for one, and the copy is then kept on disk, so nothing has to be
 * run by hand and a request can never end in a 404 just because the copy has not been made yet.
 */
export const PRODUCT_IMAGE_WIDTHS = [400, 800] as const;

// Sources worth shrinking. A GIF is left alone because it may be animated.
const sourceExtensions = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".bmp", ".tif", ".tiff"];
const sizedName = /^([a-zA-Z0-9-]+)-(400|800)\.webp$/i;

// libvips would otherwise use a thread per CPU of the host, and the hosting account counts every
// thread against its process limit. Environment variables for this were found not to be honoured
// by the Rust compiler, so the limit is set explicitly here.
sharp.concurrency(1);

export function parseSizedProductImage(filename: string) {
  const match = sizedName.exec(filename);
  return match ? { base: match[1], width: Number(match[2]) } : null;
}

async function makeSized(source: Buffer, width: number) {
  return sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    // Never enlarge: a small original keeps its own size and is only re-encoded.
    .resize({ width, withoutEnlargement: true, fit: "inside" })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}

// Written under a temporary name and then renamed, so a request never reads half a file.
async function writeAtomically(target: string, bytes: Buffer) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

/** Makes every size for a freshly uploaded picture. A failure is logged and leaves the original to serve. */
export async function writeProductImageSizes(directory: string, filename: string, source: Buffer) {
  const extension = path.extname(filename).toLowerCase();
  if (!sourceExtensions.includes(extension)) return;
  const base = path.basename(filename, extension);
  for (const width of PRODUCT_IMAGE_WIDTHS) {
    try {
      await writeAtomically(path.join(directory, `${base}-${width}.webp`), await makeSized(source, width));
    } catch (error) {
      console.warn("Product image size skipped", { width, name: error instanceof Error ? error.name : undefined });
    }
  }
}

async function findOriginal(directory: string, base: string) {
  for (const extension of sourceExtensions) {
    try {
      return { bytes: await readFile(path.join(directory, `${base}${extension}`)), extension };
    } catch { /* try the next extension */ }
  }
  return null;
}

// One browser asking for the same missing size many times, or many browsers at once, share a single
// conversion instead of each starting their own.
const inFlight = new Map<string, Promise<Buffer | null>>();

/**
 * The requested size, making it now if it is missing. Returns null when there is no original to
 * make it from, or the conversion failed, so the caller can fall back to the original itself.
 */
export function ensureProductImageSize(directory: string, filename: string): Promise<Buffer | null> {
  const parsed = parseSizedProductImage(filename);
  if (!parsed) return Promise.resolve(null);
  const target = path.join(directory, filename);
  const pending = inFlight.get(target);
  if (pending) return pending;
  const job = (async () => {
    try {
      return await readFile(target);
    } catch { /* not made yet */ }
    const original = await findOriginal(directory, parsed.base);
    if (!original) return null;
    try {
      const bytes = await makeSized(original.bytes, parsed.width);
      await writeAtomically(target, bytes);
      return bytes;
    } catch (error) {
      console.warn("Product image size could not be made", { name: error instanceof Error ? error.name : undefined });
      return null;
    }
  })().finally(() => inFlight.delete(target));
  inFlight.set(target, job);
  return job;
}

/** The original behind a size that could not be made, so the picture still shows. */
export async function originalForProductImageSize(directory: string, filename: string) {
  const parsed = parseSizedProductImage(filename);
  if (!parsed) return null;
  return findOriginal(directory, parsed.base);
}
