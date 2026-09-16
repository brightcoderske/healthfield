import { NextRequest, NextResponse } from "next/server";
import { requestUrl } from "@/lib/request-url";

const protectedAreas: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN", "SUPER_ADMIN"] },
  { prefix: "/staff", roles: ["STAFF", "ADMIN", "SUPER_ADMIN"] },
  { prefix: "/account", roles: ["CUSTOMER"] },
  { prefix: "/change-password", roles: ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"] },
];

/**
 * How long a visitor keeps the same arrangement of the catalogue.
 *
 * The homepage is deliberately shuffled so it does not read as the same twenty products
 * every time. Doing that per request meant walking to the basket and pressing Back
 * re-dealt the page, and whatever someone had just been looking at could vanish. The
 * shuffle is therefore per *visit*: one seed, kept in a cookie, so Back returns to the
 * page that was left, and a later visit gets a fresh arrangement.
 */
const LAYOUT_COOKIE = "healthfield_layout";
const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 6;

function withLayoutSeed(request: NextRequest, response: NextResponse) {
  if (request.cookies.has(LAYOUT_COOKIE)) return response;
  // Not a secret and never used for anything but arranging tiles, so a plain random
  // integer is enough; it only has to differ between visitors.
  const seed = Math.floor(Math.random() * 2 ** 31);
  response.cookies.set(LAYOUT_COOKIE, String(seed), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LAYOUT_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const fetchSite = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    const publicHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const publicProtocol = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
    const expectedOrigin = publicHost ? `${publicProtocol}://${publicHost}` : request.nextUrl.origin;
    if (fetchSite === "cross-site" || (origin && origin !== expectedOrigin)) {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
  }
  if (request.nextUrl.pathname === "/login" && (request.nextUrl.searchParams.has("password") || request.nextUrl.searchParams.has("email"))) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("email");
    clean.searchParams.delete("password");
    return NextResponse.redirect(clean);
  }
  const rule = protectedAreas.find(({ prefix }) => request.nextUrl.pathname.startsWith(prefix));
  if (!rule) return withLayoutSeed(request, NextResponse.next());

  const token = request.cookies.get("healthfield_session")?.value;
  if (!token) {
    const login = requestUrl(request,"/login");
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  try {
    const apiBase = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    const apiKey = process.env.API_SHARED_SECRET;
    if (!apiBase || !apiKey) return new NextResponse("Authentication service is not configured.", { status: 503 });
    let validation: Response;
    try {
      validation = await fetch(`${apiBase}/v1/auth/session`, { headers: { Authorization: `Bearer ${token}`, "X-Healthfield-Key": apiKey }, cache: "no-store" });
    } catch {
      return new NextResponse("Authentication service is temporarily unavailable.", { status: 503, headers: { "Retry-After": "30" } });
    }
    if (validation.status === 401 || validation.status === 403) {
      const login = requestUrl(request, "/login");
      login.searchParams.set("next", request.nextUrl.pathname);
      login.searchParams.set("error", "session_expired");
      const response = NextResponse.redirect(login);
      response.cookies.delete("healthfield_session");
      return response;
    }
    if (!validation.ok) return new NextResponse("Authentication service is temporarily unavailable.", { status: 503, headers: { "Retry-After": "30" } });
    const validated = await validation.json().catch(() => null) as { session?: { role?: string } } | null;
    if (!validated?.session?.role) return new NextResponse("Authentication service returned an invalid response.", { status: 503 });
    if (!rule.roles.includes(validated.session.role)) return NextResponse.redirect(requestUrl(request,"/unauthorized"));
    return NextResponse.next();
  } catch (error) {
    console.error("[auth.proxy] session validation failed", { name: error instanceof Error ? error.name : undefined });
    return new NextResponse("Authentication service is temporarily unavailable.", { status: 503, headers: { "Retry-After": "30" } });
  }
}

export const config = {
  // "/" is here only so the homepage gets a layout seed on a visitor's first request;
  // it matches no protected area and falls straight through.
  matcher: ["/", "/api/:path*", "/login", "/admin/:path*", "/staff/:path*", "/account/:path*", "/change-password"],
};
