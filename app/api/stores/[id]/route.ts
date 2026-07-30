import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { branches } from "@/db/schema";
import { getSession } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  code: z.string().trim().min(2).max(30).transform((value) => value.toUpperCase()).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  email: z.string().trim().email().or(z.literal("")).optional(),
  address: z.string().trim().min(4).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: parsed.success ? "Invalid store." : parsed.error.issues[0]?.message }, { status: 400 });
  await getDb().update(branches).set({ ...parsed.data, email: parsed.data.email === "" ? null : parsed.data.email }).where(eq(branches.id, id));
  return NextResponse.json({ ok: true });
}
