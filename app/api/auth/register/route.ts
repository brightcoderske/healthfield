import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";

const schema = z.object({
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(9).max(30),
  password: z.string().min(8).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete every field and use a strong password." }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existing) return NextResponse.json({ error: "An account already uses this email." }, { status: 409 });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const [result] = await db.insert(users).values({ ...parsed.data, passwordHash, role: "CUSTOMER", isActive: true, twoFactorEnabled: false, forcePasswordChange: false });
  const token = await createSessionToken({ userId: result.insertId, email: parsed.data.email, firstName: parsed.data.firstName, role: "CUSTOMER", forcePasswordChange: false });
  const response = NextResponse.json({ ok: true, redirectTo: "/account" }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 8, path: "/" });
  return response;
}
