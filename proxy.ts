import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { requestUrl } from "@/lib/request-url";

const protectedAreas: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN", "SUPER_ADMIN"] },
  { prefix: "/staff", roles: ["STAFF", "ADMIN", "SUPER_ADMIN"] },
  { prefix: "/account", roles: ["CUSTOMER"] },
  { prefix: "/change-password", roles: ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"] },
];

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login" && (request.nextUrl.searchParams.has("password") || request.nextUrl.searchParams.has("email"))) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("email");
    clean.searchParams.delete("password");
    return NextResponse.redirect(clean);
  }
  const rule = protectedAreas.find(({ prefix }) => request.nextUrl.pathname.startsWith(prefix));
  if (!rule) return NextResponse.next();

  const token = request.cookies.get("healthfield_session")?.value;
  if (!token) {
    const login = requestUrl(request,"/login");
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: "healthfield-pharmacy",
      audience: "healthfield-web",
    });
    if (!rule.roles.includes(String(payload.role))) {
      return NextResponse.redirect(requestUrl(request,"/unauthorized"));
    }
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
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(requestUrl(request,"/login"));
    response.cookies.delete("healthfield_session");
    return response;
  }
}

export const config = {
  matcher: ["/login", "/admin/:path*", "/staff/:path*", "/account/:path*", "/change-password"],
};
