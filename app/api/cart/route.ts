import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { backendJson } from "@/lib/backend-api";
import { prescriptionUploadHref } from "@/lib/prescription-selection";
import {
  CART_COOKIE,
  MAX_BUNDLES_PER_OFFER,
  parseCart,
  parseCartOffers,
  serializeCart,
} from "@/lib/shopping-state";
import { requestUrl } from "@/lib/request-url";

type CatalogueProduct = {
  id: number;
  name: string;
  prescriptionRequired: boolean;
};
type CatalogueOffer = {
  id: number;
  title: string;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
    prescriptionRequired: boolean;
  }>;
};
type CatalogueData = {
  products: CatalogueProduct[];
  offers?: CatalogueOffer[];
};

function safeReturn(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export async function POST(request: Request) {
  const form = await request.formData();
  const productId = Number(form.get("productId"));
  const offerId = Number(form.get("offerId"));
  const action = String(form.get("action") || "add");
  const jar = await cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const offers = parseCartOffers(jar.get(CART_COOKIE)?.value);
  const wantsJson = request.headers.get("accept")?.includes("application/json");

  const positiveProductChange =
    Number.isInteger(productId) &&
    productId > 0 &&
    action !== "remove" &&
    !(action === "set" && Number(form.get("quantity")) <= 0);
  const positiveOfferChange =
    Number.isInteger(offerId) && offerId > 0 && action !== "remove";
  if (positiveProductChange || positiveOfferChange) {
    let data: CatalogueData;
    try {
      data = await backendJson<CatalogueData>(
        `/v1/views/catalogue?ids=${positiveProductChange ? productId : ""}`,
      );
    } catch {
      return NextResponse.json(
        { error: "The catalogue could not be checked. Please try again." },
        { status: 503 },
      );
    }
    const prescriptionItems = positiveProductChange
      ? data.products
          .filter(
            (product) =>
              product.id === productId && product.prescriptionRequired,
          )
          .map((product) => ({
            id: product.id,
            name: product.name,
            quantity: Math.min(
              99,
              Math.max(1, Number(form.get("quantity")) || 1),
            ),
          }))
      : (data.offers || [])
          .find((offer) => offer.id === offerId)
          ?.items.filter((item) => item.prescriptionRequired)
          .map((item) => ({
            id: item.productId,
            name: item.name,
            quantity: item.quantity,
          })) || [];
    const itemExists = positiveProductChange
      ? data.products.some((product) => product.id === productId)
      : (data.offers || []).some((offer) => offer.id === offerId);
    if (!itemExists)
      return NextResponse.json(
        {
          error: positiveProductChange
            ? "This product is no longer available."
            : "This offer is no longer available.",
        },
        { status: 409 },
      );
    if (prescriptionItems.length) {
      const uploadUrl = prescriptionUploadHref(prescriptionItems);
      if (!wantsJson)
        return NextResponse.redirect(requestUrl(request, uploadUrl), 303);
      return NextResponse.json(
        {
          error: "A valid prescription is required for this medicine.",
          code: "PRESCRIPTION_REQUIRED",
          prescriptionItems,
          uploadUrl,
        },
        { status: 409 },
      );
    }
  }

  if (Number.isInteger(offerId) && offerId > 0) {
    // A bundle is a fixed package: it is either in the basket once, or not at all.
    if (action === "remove") delete offers[offerId];
    else offers[offerId] = MAX_BUNDLES_PER_OFFER;
  } else if (Number.isInteger(productId) && productId > 0) {
    if (action === "remove") delete cart[productId];
    else if (action === "set") {
      const quantity = Math.min(99, Math.max(0, Number(form.get("quantity"))));
      if (quantity > 0) cart[productId] = quantity;
      else delete cart[productId];
    } else {
      const quantity = Math.min(
        99,
        Math.max(1, Number(form.get("quantity") || 1)),
      );
      cart[productId] = Math.min(99, (cart[productId] || 0) + quantity);
    }
  }

  const response = wantsJson
    ? NextResponse.json({ ok: true, cart, offers })
    : NextResponse.redirect(
        requestUrl(request, safeReturn(form.get("return"))),
        303,
      );
  response.cookies.set(CART_COOKIE, serializeCart(cart, offers), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CART_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function PUT(request: Request) {
  const parsed = (await request.json().catch(() => null)) as {
    items?: Array<{ productId?: unknown; quantity?: unknown }>;
  } | null;
  if (!Array.isArray(parsed?.items))
    return NextResponse.json(
      { error: "Choose order items to restore." },
      { status: 400 },
    );
  const cart: Record<number, number> = {};
  for (const item of parsed.items.slice(0, 100)) {
    const productId = Number(item.productId);
    const quantity = Math.min(99, Math.max(1, Number(item.quantity)));
    if (
      Number.isInteger(productId) &&
      productId > 0 &&
      Number.isInteger(quantity)
    )
      cart[productId] = Math.min(99, (cart[productId] || 0) + quantity);
  }
  if (!Object.keys(cart).length)
    return NextResponse.json(
      { error: "None of this order's products can be restored to the cart." },
      { status: 409 },
    );
  let products: CatalogueProduct[];
  try {
    const data = await backendJson<CatalogueData>(
      `/v1/views/catalogue?ids=${Object.keys(cart).join(",")}`,
    );
    products = data.products;
  } catch {
    return NextResponse.json(
      { error: "The catalogue could not be checked. Please try again." },
      { status: 503 },
    );
  }
  const availableIds = new Set(products.map((product) => product.id));
  const prescriptionItems = products
    .filter((product) => product.prescriptionRequired && cart[product.id])
    .map((product) => ({
      id: product.id,
      name: product.name,
      quantity: cart[product.id],
    }));
  for (const productId of Object.keys(cart).map(Number)) {
    if (
      !availableIds.has(productId) ||
      prescriptionItems.some((item) => item.id === productId)
    )
      delete cart[productId];
  }
  if (!Object.keys(cart).length)
    return NextResponse.json(
      {
        error:
          "This order only contains prescription medicines. Upload the prescription to request them.",
        code: "PRESCRIPTION_REQUIRED",
        prescriptionItems,
        uploadUrl: prescriptionUploadHref(prescriptionItems),
      },
      { status: 409 },
    );
  const response = NextResponse.json({
    ok: true,
    cart,
    offers: {},
    excludedPrescriptionItems: prescriptionItems,
    uploadUrl: prescriptionItems.length
      ? prescriptionUploadHref(prescriptionItems)
      : null,
  });
  response.cookies.set(CART_COOKIE, serializeCart(cart, {}), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}

export async function PATCH(request: Request) {
  const parsed = (await request.json().catch(() => null)) as {
    productIds?: unknown;
  } | null;
  const productIds = Array.isArray(parsed?.productIds)
    ? [
        ...new Set(
          parsed.productIds
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ].slice(0, 50)
    : [];
  if (!productIds.length)
    return NextResponse.json(
      { error: "Choose cart products to remove." },
      { status: 400 },
    );
  const jar = await cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const offers = parseCartOffers(jar.get(CART_COOKIE)?.value);
  for (const productId of productIds) delete cart[productId];
  const response = NextResponse.json({ ok: true, cart, offers });
  response.cookies.set(CART_COOKIE, serializeCart(cart, offers), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
