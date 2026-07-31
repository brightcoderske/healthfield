import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { requestUrl } from "@/lib/request-url";

export async function POST(request: Request) {
  const response = NextResponse.redirect(requestUrl(request,"/#products"), 303);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  });
  return response;
}
