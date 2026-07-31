import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { PRODUCT_IMAGE_TYPES, productUploadDirectory } from "@/lib/product-upload";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ filename: string }> }) {
  const filename = (await params).filename;
  // Generated uploads use a simple filename; rejecting separators prevents traversal.
  if (!/^[a-zA-Z0-9-]+\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(filename)) {
    return new NextResponse("Image not found.", { status: 404 });
  }
  const extension = path.extname(filename).slice(1).toLowerCase();
  try {
    const image = await readFile(path.join(productUploadDirectory(), filename));
    return new NextResponse(image, {
      headers: {
        "Content-Type": PRODUCT_IMAGE_TYPES[extension] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Image not found.", { status: 404 });
  }
}
