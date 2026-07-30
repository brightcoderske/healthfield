import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "healthfield_session";
export type Role = "CUSTOMER" | "STAFF" | "ADMIN" | "SUPER_ADMIN";

export type Session = {
  userId: number;
  email: string;
  firstName: string;
  role: Role;
  forcePasswordChange: boolean;
};

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setIssuer("healthfield-pharmacy")
    .setAudience("healthfield-web")
    .sign(getSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: "healthfield-pharmacy",
    audience: "healthfield-web",
  });
  return payload as unknown as Session;
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function requireRole(allowed: Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!allowed.includes(session.role)) redirect("/unauthorized");
  return session;
}

export function roleHome(role: Role) {
  if (role === "SUPER_ADMIN" || role === "ADMIN") return "/admin";
  if (role === "STAFF") return "/staff";
  return "/account";
}
