import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { authSessions, staffPermissions, users } from "../../db/schema";
import { normalizeStaffPermissions, type StaffPermission } from "../../lib/staff-permissions";
import { getDb } from "./db";

export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";
export type Session = { userId: number; email: string; firstName: string; role: Role; forcePasswordChange: boolean; homeBranchId: number | null; permissions: StaffPermission[] };
export type ResetPayload = { userId: number; email: string; purpose: "password-reset" };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

const sessionTokenPrefix = "hfs_";
const sessionTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
// MySQL hosts running with explicit_defaults_for_timestamp=OFF turn a nullable
// TIMESTAMP into NOT NULL DEFAULT '0000-00-00 00:00:00', which the driver reads
// back as an Invalid Date. Treat that zero value as "never set".
export const hasStoredTimestamp = (value: Date | null) => value instanceof Date && !Number.isNaN(value.getTime());

export async function createSessionToken(session: Session) {
  const now = Date.now();
  const lifetimeMs = 60 * 60 * 1000 * (session.role === "CUSTOMER" ? 8 : 12);
  const token = `${sessionTokenPrefix}${randomBytes(32).toString("base64url")}`;
  const db = getDb();
  await db.delete(authSessions).where(lt(authSessions.expiresAtMs, now));
  await db.insert(authSessions).values({
    userId: session.userId,
    tokenHash: sessionTokenHash(token),
    expiresAt: new Date(now + lifetimeMs),
    expiresAtMs: now + lifetimeMs,
    revokedAt: null,
  });
  return token;
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
  const token = header.slice(7);
  if (token.startsWith(sessionTokenPrefix)) {
    try {
      const [session] = await getDb().select({
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        role: users.role,
        forcePasswordChange: users.forcePasswordChange,
        homeBranchId: users.homeBranchId,
        revokedAt: authSessions.revokedAt,
        deletedAt: users.deletedAt,
      }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id)).where(and(
        eq(authSessions.tokenHash, sessionTokenHash(token)),
        gt(authSessions.expiresAtMs, Date.now()),
        eq(users.isActive, true),
      )).limit(1);
      if (!session || hasStoredTimestamp(session.revokedAt) || hasStoredTimestamp(session.deletedAt)) {
        console.error("[auth.session] rejected", { reason: "opaque_session_invalid" });
        return null;
      }
      const permissionRows = session.role === "STAFF" ? await getDb().select({ permission: staffPermissions.permission }).from(staffPermissions).where(eq(staffPermissions.userId, session.userId)) : [];
      return { ...session, permissions: normalizeStaffPermissions(permissionRows.map((row) => row.permission)) } as Session;
    } catch (error) {
      console.error("[auth.session] rejected", { reason: "opaque_session_database_error", code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined, name: error instanceof Error ? error.name : undefined });
      return null;
    }
  }
  if (!allowUploadToken) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "healthfield-pharmacy",
      audience: "healthfield-upload",
      clockTolerance: 60,
    });
    if (typeof payload.userId !== "number" || typeof payload.email !== "string" || typeof payload.firstName !== "string" || !["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"].includes(String(payload.role)) || typeof payload.forcePasswordChange !== "boolean" || !(payload.homeBranchId === null || typeof payload.homeBranchId === "number")) return null;
    return { ...(payload as unknown as Omit<Session, "permissions">), permissions: normalizeStaffPermissions(Array.isArray(payload.permissions) ? payload.permissions.filter((value): value is string => typeof value === "string") : []) };
  } catch {
    return null;
  }
}

export async function revokeSession(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith(`Bearer ${sessionTokenPrefix}`)) return;
  await getDb().update(authSessions).set({ revokedAt: new Date() }).where(and(
    eq(authSessions.tokenHash, sessionTokenHash(header.slice(7))),
    isNull(authSessions.revokedAt),
  ));
}

export async function revokeUserSessions(userId: number) {
  await getDb().update(authSessions).set({ revokedAt: new Date() }).where(and(
    eq(authSessions.userId, userId),
    isNull(authSessions.revokedAt),
  ));
}

export async function requireSession(request: Request, roles?: Role[], allowUploadToken = false) {
  const session = await requestSession(request, allowUploadToken);
  if (!session) return { response: Response.json({ error: "Authentication required." }, { status: 401 }) } as const;
  if (roles && !roles.includes(session.role)) return { response: Response.json({ error: "Access denied." }, { status: 403 }) } as const;
  return { session } as const;
}
