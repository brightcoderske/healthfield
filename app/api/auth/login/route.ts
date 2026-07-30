import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken, roleHome, SESSION_COOKIE } from "@/lib/auth";
import { requestUrl } from "@/lib/request-url";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
  const input = isForm ? Object.fromEntries(await request.formData()) : await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    if (isForm) return NextResponse.redirect(requestUrl(request, "/login?error=invalid"), 303);
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const validPassword = user
    ? await bcrypt.compare(parsed.data.password, user.passwordHash)
    : await bcrypt.compare(parsed.data.password, "$2b$12$1BVjhn5Hc7qJCnn84gWmTOj3DdbFI4zmL.RXsnXC6CIscSwMPxYjC");

  if (!user || !validPassword || !user.isActive) {
    if (isForm) return NextResponse.redirect(requestUrl(request, "/login?error=incorrect"), 303);
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role,
    forcePasswordChange: user.forcePasswordChange,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const redirectTo = user.forcePasswordChange ? "/change-password" : roleHome(user.role);
  const response = isForm
    ? NextResponse.redirect(requestUrl(request, redirectTo), 303)
    : NextResponse.json({ ok: true, redirectTo });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
