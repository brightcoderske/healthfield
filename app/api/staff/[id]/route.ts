import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";

const schema = z.object({
  firstName: z.string().trim().min(2).max(100).optional(), lastName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional(), role: z.enum(["STAFF", "ADMIN"]).optional(),
  homeBranchId: z.coerce.number().int().positive().nullable().optional(), isActive: z.boolean().optional(),
  password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: "Check the staff details." }, { status: 400 });
  const { password, ...values } = parsed.data;
  await getDb().update(users).set({ ...values, phone: values.phone === "" ? null : values.phone, ...(password ? { passwordHash: await hash(password, 12), forcePasswordChange: true } : {}) }).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
