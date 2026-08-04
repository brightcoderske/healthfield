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

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const apiBase = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
  const apiKey = process.env.API_SHARED_SECRET;
  if (!apiBase || !apiKey) throw new Error("Authentication service is not configured.");
  const response = await fetch(`${apiBase}/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}`, "X-Healthfield-Key": apiKey },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Authentication service returned ${response.status}.`);
  const data = await response.json() as { session?: Session };
  if (!data.session) throw new Error("Authentication service returned an invalid response.");
  return data.session;
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
