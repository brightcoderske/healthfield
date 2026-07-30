import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { branches, branchInventory, productHealthConditions, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

const productSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(220),
  brand: z.string().trim().max(150).optional().default(""),
  shortDescription: z.string().trim().max(500).optional().default(""),
  imageUrl: z.string().trim().max(500).optional().default(""),
  price: z.coerce.number().nonnegative(),
  discountPrice: z.coerce.number().nonnegative().optional(),
  packSize: z.string().trim().max(100).optional().default(""),
  prescriptionRequired: z.coerce.boolean().default(false),
  isFeatured: z.coerce.boolean().default(false),
  conditionIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});

export async function GET() {
  const db = getDb();
  const rows = await db.select().from(products).where(eq(products.isActive, true)).orderBy(desc(products.isFeatured), desc(products.createdAt));
  return NextResponse.json({ products: rows }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }
  const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
  const raw = isForm ? Object.fromEntries(await request.formData()) : await request.json().catch(() => null);
  if (isForm && raw) {
    const form = raw as Record<string, unknown>;
    form.conditionIds = typeof form.conditionIds === "string" ? [form.conditionIds] : [];
    form.prescriptionRequired = form.prescriptionRequired === "on";
    form.isFeatured = form.isFeatured === "on";
  }
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid product." }, { status: 400 });
  }
  const values = parsed.data;
  const baseSlug = values.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const uniqueSuffix = Date.now().toString(36);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(products).values({
      categoryId: values.categoryId,
      name: values.name,
      slug: `${baseSlug}-${uniqueSuffix}`,
      sku: `HF-${uniqueSuffix.toUpperCase()}`,
      brand: values.brand || null,
      shortDescription: values.shortDescription || null,
      imageUrl: values.imageUrl || null,
      discountPrice: values.discountPrice?.toString() ?? null,
      price: values.price.toString(),
      packSize: values.packSize || null,
      prescriptionRequired: values.prescriptionRequired,
      isFeatured: values.isFeatured,
      isActive: true,
    });
    if (values.conditionIds.length) {
      await tx.insert(productHealthConditions).values(values.conditionIds.map((conditionId) => ({ productId: created.insertId, conditionId })));
    }
    const activeStores = await tx.select({ id: branches.id }).from(branches).where(eq(branches.isActive, true));
    if (activeStores.length) {
      await tx.insert(branchInventory).values(activeStores.map((store) => ({
        branchId: store.id, productId: created.insertId, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: session.userId,
      })));
    }
    return created;
  });
  if (isForm) return NextResponse.redirect(new URL("/admin/products", request.url), 303);
  return NextResponse.json({ ok: true, id: result.insertId }, { status: 201 });
}
