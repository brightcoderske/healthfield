import { desc, ne } from "drizzle-orm";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";

const schema = z.object({
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional().default(""),
  role: z.enum(["STAFF", "ADMIN"]),
  homeBranchId: z.coerce.number().int().positive().nullable().optional(),
  password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
});

export async function GET() {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  return NextResponse.json({ staff: await getDb().select().from(users).where(ne(users.role, "CUSTOMER")).orderBy(desc(users.createdAt)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter valid staff details and an 8-character password with upper, lower and number." }, { status: 400 });
  try {
    const { password, ...values } = parsed.data;
    const [created] = await getDb().insert(users).values({ ...values, phone: values.phone || null, passwordHash: await hash(password, 12), isActive: true, forcePasswordChange: true });
    return NextResponse.json({ id: created.insertId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "That email address or phone is already registered." }, { status: 409 });
  }
}
