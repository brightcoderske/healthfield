import { jwtVerify, SignJWT } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "../../db/schema";
import { getDb } from "./db";

export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";
export type Session = { userId: number; email: string; firstName: string; role: Role; forcePasswordChange: boolean };
export type ResetPayload = { userId: number; email: string; purpose: "password-reset" };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

export async function createSessionToken(session: Session) {
  const now = Math.floor(Date.now() / 1000);
  const lifetimeSeconds = 60 * 60 * (session.role === "CUSTOMER" ? 8 : 12);
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .setIssuer("healthfield-pharmacy")
    .setAudience("healthfield-web")
    .sign(secret());
}

export async function createUploadToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setIssuer("healthfield-pharmacy")
    .setAudience("healthfield-upload")
    .sign(secret());
}

export async function createPasswordResetToken(user: { userId: number; email: string }) {
  return new SignJWT({ userId: user.userId, email: user.email, purpose: "password-reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setIssuer("healthfield-pharmacy")
    .setAudience("healthfield-reset")
    .sign(secret());
}

export async function verifyPasswordResetToken(token: string): Promise<ResetPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "healthfield-pharmacy",
      audience: "healthfield-reset",
    });
    if (payload.purpose !== "password-reset" || typeof payload.userId !== "number" || typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email, purpose: "password-reset" };
  } catch {
    return null;
  }
}

export async function requestSession(request: Request, allowUploadToken = false): Promise<Session | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret(), {
      issuer: "healthfield-pharmacy",
      audience: allowUploadToken ? ["healthfield-web", "healthfield-upload"] : "healthfield-web",
      clockTolerance: 60,
    });
    if (typeof payload.userId !== "number" || typeof payload.email !== "string" || typeof payload.firstName !== "string" || !["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"].includes(String(payload.role)) || typeof payload.forcePasswordChange !== "boolean") {
      console.error("[auth.session] rejected", { reason: "invalid_payload" });
      return null;
    }
    const session = payload as unknown as Session;
    const [user] = await getDb().select({ role: users.role, isActive: users.isActive }).from(users).where(and(eq(users.id, session.userId), isNull(users.deletedAt))).limit(1);
    if (!user) {
      console.error("[auth.session] rejected", { reason: "account_missing", userId: session.userId });
      return null;
    }
    if (!user.isActive) {
      console.error("[auth.session] rejected", { reason: "account_inactive", userId: session.userId });
      return null;
    }
    if (user.role !== session.role) {
      console.error("[auth.session] rejected", { reason: "role_changed", userId: session.userId });
      return null;
    }
    return session;
  } catch (error) {
    console.error("[auth.session] rejected", { reason: "token_or_database_error", code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined, name: error instanceof Error ? error.name : undefined });
    return null;
  }
}

export async function requireSession(request: Request, roles?: Role[], allowUploadToken = false) {
  const session = await requestSession(request, allowUploadToken);
  if (!session) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (roles && !roles.includes(session.role)) return { response: Response.json({ error: "Access denied." }, { status: 403 }) } as const;
  return { session } as const;
}
