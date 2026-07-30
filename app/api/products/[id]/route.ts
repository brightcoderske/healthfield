import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { productHealthConditions, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(220).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brand: z.string().trim().max(150).nullable().optional(),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  packSize: z.string().trim().max(100).nullable().optional(),
  price: z.coerce.number().nonnegative().optional(),
  discountPrice: z.coerce.number().nonnegative().nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  conditionIds: z.array(z.coerce.number().int().positive()).optional(),
});

async function authorize() {
  const session = await getSession();
  return session && ["ADMIN", "SUPER_ADMIN"].includes(session.role);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorize())) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid product update." }, { status: 400 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid product." }, { status: 400 });
  const { conditionIds, ...update } = parsed.data;
  const values = {
    ...update,
    price: parsed.data.price?.toString(),
    discountPrice: parsed.data.discountPrice === null ? null : parsed.data.discountPrice?.toString(),
  };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(products).set(values).where(eq(products.id, id));
    if (conditionIds) {
      await tx.delete(productHealthConditions).where(eq(productHealthConditions.productId, id));
      if (conditionIds.length) await tx.insert(productHealthConditions).values(conditionIds.map((conditionId) => ({ productId: id, conditionId })));
    }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await authorize())) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid product." }, { status: 400 });
  // Soft deletion preserves order history and auditability.
  await getDb().update(products).set({ isActive: false }).where(eq(products.id, id));
  return NextResponse.json({ ok: true });
}
