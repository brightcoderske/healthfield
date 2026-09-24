"use client";

/**
 * Thin wrappers around window.fbq. Every call is a no-op until the base pixel
 * script (see app/meta-pixel.tsx) has loaded and initialized, and a no-op again
 * when NEXT_PUBLIC_META_PIXEL_ID is unset — so these are always safe to call.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function fbq(...args: unknown[]) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq(...args);
}

const DEFAULT_CURRENCY = "KES";

export function trackPageView() {
  fbq("track", "PageView");
}

export function trackViewContent(params: {
  contentId: number | string;
  contentName: string;
  value?: number;
  currency?: string;
}) {
  fbq("track", "ViewContent", {
    content_ids: [String(params.contentId)],
    content_type: "product",
    content_name: params.contentName,
    value: params.value,
    currency: params.currency ?? DEFAULT_CURRENCY,
  });
}

export function trackAddToCart(params: {
  contentId: number | string;
  contentName: string;
  quantity: number;
  value: number;
  currency?: string;
}) {
  fbq("track", "AddToCart", {
    content_ids: [String(params.contentId)],
    content_type: "product",
    content_name: params.contentName,
    contents: [{ id: String(params.contentId), quantity: params.quantity }],
    value: params.value,
    currency: params.currency ?? DEFAULT_CURRENCY,
  });
}

export function trackInitiateCheckout(params: {
  contentIds: Array<number | string>;
  numItems: number;
  value: number;
  currency?: string;
}) {
  fbq("track", "InitiateCheckout", {
    content_ids: params.contentIds.map(String),
    content_type: "product",
    num_items: params.numItems,
    value: params.value,
    currency: params.currency ?? DEFAULT_CURRENCY,
  });
}

export function trackPurchase(params: {
  orderId: number | string;
  orderNumber: string;
  contentIds: Array<number | string>;
  value: number;
  currency?: string;
}) {
  fbq(
    "track",
    "Purchase",
    {
      content_ids: params.contentIds.map(String),
      content_type: "product",
      value: params.value,
      currency: params.currency ?? DEFAULT_CURRENCY,
      order_id: params.orderId,
      order_number: params.orderNumber,
    },
    // Lets a future server-side CAPI send of the same order dedupe against this
    // browser event instead of double-counting it.
    { eventID: `purchase-${params.orderId}` },
  );
}
