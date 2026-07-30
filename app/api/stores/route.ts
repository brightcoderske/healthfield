import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { branchInventory, branches, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().or(z.literal("")),
  address: z.string().trim().min(4),
});

export async function GET() {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  return NextResponse.json({ stores: await getDb().select().from(branches).orderBy(desc(branches.createdAt)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the store details." }, { status: 400 });
  try {
    const db = getDb();
    const created = await db.transaction(async (tx) => {
      const [store] = await tx.insert(branches).values({ ...parsed.data, email: parsed.data.email || null, isActive: true });
      const catalogue = await tx.select({ id: products.id }).from(products);
      if (catalogue.length) await tx.insert(branchInventory).values(catalogue.map((product) => ({ branchId: store.insertId, productId: product.id, quantityAvailable: 0, quantityReserved: 0, reorderLevel: 5, updatedBy: session.userId })));
      return store;
    });
    return NextResponse.json({ id: created.insertId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "That store code is already in use." }, { status: 409 });
  }
}
