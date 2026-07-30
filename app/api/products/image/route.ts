import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const allowedTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/gif", "gif"], ["image/avif", "avif"], ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "Choose a product image." }, { status: 400 });
  const extension = allowedTypes.get(image.type.toLowerCase());
  if (!extension) return NextResponse.json({ error: "Use JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF." }, { status: 415 });
  if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Product images must be 2 MB or smaller." }, { status: 413 });
  const bytes = Buffer.from(await image.arrayBuffer());
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(process.cwd(), "public", "uploads", "products");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
  return NextResponse.json({ imageUrl: `/uploads/products/${filename}` }, { status: 201 });
}
