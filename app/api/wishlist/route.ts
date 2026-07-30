import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { parseWishlist, WISHLIST_COOKIE } from "@/lib/shopping-state";
import { requestUrl } from "@/lib/request-url";

export async function POST(request: Request) {
  const form = await request.formData();
  const productId = Number(form.get("productId"));
  const jar = await cookies();
  let wishlist = parseWishlist(jar.get(WISHLIST_COOKIE)?.value);
  if (Number.isInteger(productId) && productId > 0) wishlist = wishlist.includes(productId) ? wishlist.filter((id) => id !== productId) : [...wishlist, productId];
  const returnTo = String(form.get("return") || "/");
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const response = NextResponse.redirect(requestUrl(request, safeReturn), 303);
  response.cookies.set(WISHLIST_COOKIE, JSON.stringify(wishlist), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" });
  return response;
}
