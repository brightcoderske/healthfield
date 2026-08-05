import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = Math.max(1, Math.min(Number(limitArgument?.slice(8) || 20), 100));
const storageRoot = path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), "storage"));
const productDirectory = path.join(storageRoot, "uploads", "products");
const originalsDirectory = path.join(productDirectory, "originals");
const files = (await readdir(productDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name)).slice(0, limit);

await mkdir(originalsDirectory, { recursive: true });
let optimized = 0;
for (const entry of files) {
  const source = path.join(productDirectory, entry.name);
  const backup = path.join(originalsDirectory, entry.name);
  try {
    await stat(backup);
    continue;
  } catch { /* Original has not been archived yet. */ }
  const extension = path.extname(entry.name).toLowerCase();
  const temporary = `${source}.optimizing`;
  try {
    const image = sharp(source, { limitInputPixels: 40_000_000 }).rotate();
    if (extension === ".png") await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(temporary);
    else if (extension === ".webp") await image.webp({ quality: 88, effort: 4 }).toFile(temporary);
    else await image.jpeg({ quality: 88, progressive: true, mozjpeg: true }).toFile(temporary);
    const [sourceInfo, optimizedInfo] = await Promise.all([stat(source), stat(temporary)]);
    await copyFile(source, backup);
    if (optimizedInfo.size < sourceInfo.size) {
      await rename(temporary, source);
      optimized += 1;
    } else {
      await rm(temporary, { force: true });
    }
  } catch (error) {
    await rm(temporary, { force: true });
    console.warn(`Skipped ${entry.name}:`, error instanceof Error ? error.message : "unknown error");
  }
}
console.log(`Product image optimization complete: ${optimized} optimized, ${files.length - optimized} retained or skipped.`);
