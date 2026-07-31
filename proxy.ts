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
