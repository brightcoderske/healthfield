import path from "path";

export const PRODUCT_IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff",
};

export function productUploadDirectory() {
  return path.resolve(process.cwd(), "public", "uploads", "products");
}
