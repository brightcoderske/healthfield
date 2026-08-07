import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { requestUrl } from "@/lib/request-url";

function safeReturn(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const productId = Number(form.get("productId"));
  const action = String(form.get("action") || "add");
  const jar = await cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  if (Number.isInteger(productId) && productId > 0) {
    if (action === "remove") delete cart[productId];
    else if (action === "set") {
      const quantity = Math.min(99, Math.max(0, Number(form.get("quantity"))));
      if (quantity > 0) cart[productId] = quantity;
      else delete cart[productId];
    } else {
      const quantity = Math.min(99, Math.max(1, Number(form.get("quantity") || 1)));
      cart[productId] = Math.min(99, (cart[productId] || 0) + quantity);
    }
  }
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  const response = wantsJson ? NextResponse.json({ ok: true, cart }) : NextResponse.redirect(requestUrl(request, safeReturn(form.get("return"))), 303);
  response.cookies.set(CART_COOKIE, JSON.stringify(cart), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CART_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
