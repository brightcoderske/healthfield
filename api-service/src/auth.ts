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
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(session.role === "CUSTOMER" ? "8h" : "12h")
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
    });
    const session = payload as unknown as Session;
    const [user] = await getDb().select({ role: users.role, isActive: users.isActive, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(and(eq(users.id, session.userId), isNull(users.deletedAt))).limit(1);
    if (!user || !user.isActive || user.role !== session.role) return null;
    if (user.role !== "CUSTOMER" && !user.twoFactorEnabled) return null;
    return session;
  } catch {
    return null;
  }
}

export async function requireSession(request: Request, roles?: Role[], allowUploadToken = false) {
  const session = await requestSession(request, allowUploadToken);
  if (!session) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (roles && !roles.includes(session.role)) return { response: Response.json({ error: "Access denied." }, { status: 403 }) } as const;
  return { session } as const;
}
