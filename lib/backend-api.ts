import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./auth";

function apiBase() {
  const value = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!value) throw new Error("API_BASE_URL is required.");
  return value.replace(/\/$/, "");
}

function apiKey() {
  if (!process.env.API_SHARED_SECRET) throw new Error("API_SHARED_SECRET is required.");
  return process.env.API_SHARED_SECRET;
}

export class BackendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function backendRequest(path: string, init: RequestInit = {}) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers = new Headers(init.headers);
  headers.set("X-Healthfield-Key", apiKey());
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers, cache: init.cache ?? "no-store" });
}

export async function backendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await backendRequest(path, init);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new BackendError(response.status || 502, "The API returned a non-JSON response. Check API_BASE_URL and disable bot protection on the API hostname.");
  }
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new BackendError(response.status, data.error || "Backend request failed.");
  return data;
}

export async function backendPublicJson<T>(
  path: string,
  revalidate = 60,
  tags: string[] = [],
): Promise<T> {
  const headers = new Headers();
  headers.set("X-Healthfield-Key", apiKey());
  const response = await fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
    headers,
    next: { revalidate, tags },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new BackendError(response.status || 502, "The API returned a non-JSON response. Check API_BASE_URL and disable bot protection on the API hostname.");
  }
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new BackendError(response.status, data.error || "Backend request failed.");
  return data;
}

export async function proxyToBackend(request: Request, path: string) {
  const encodedToken = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const token = encodedToken ? decodeURIComponent(encodedToken) : undefined;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("X-Healthfield-Key", apiKey());
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = request.method.toUpperCase();
  const body = ["GET", "HEAD"].includes(method) ? undefined : await request.arrayBuffer();
  const target = `${apiBase()}${path.startsWith("/") ? path : `/${path}`}${new URL(request.url).search}`;
  const response = await fetch(target, { method, headers, body, cache: "no-store" });
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}

export async function proxyAuth(request: Request, action: "login" | "register" | "change-password" | "verify-email" | "resend-verification" | "two-factor" | "two-factor-resend") {
  const contentType = request.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await request.json().catch(() => null) : Object.fromEntries(await request.formData());
  const clientIp = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 64);
  const response = await backendRequest(`/v1/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Healthfield-Client-IP": clientIp }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({})) as { token?: string; redirectTo?: string; error?: string; role?: string; [key: string]: unknown };
  const { token, ...clientData } = data;
  const result = NextResponse.json(clientData, { status: response.status });
  if (response.ok && token) {
    result.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * (data.role === "CUSTOMER" ? 8 : 12), path: "/", priority: "high" });
  } else if (action === "login") {
    result.cookies.delete(SESSION_COOKIE);
  }
  return result;
}

export async function proxyLogout(request: Request) {
  await backendRequest("/v1/auth/logout", { method: "POST" }).catch(() => null);
  const result = NextResponse.redirect(new URL("/#products", request.url), 303);
  result.cookies.delete(SESSION_COOKIE);
  return result;
}
