"use client";

import { useEffect, useState } from "react";
import type { PinnedLocation } from "./map-picker";

export type DeliveryOptions = {
  /** False when the shop is still on a flat fee; the pin is then informational only. */
  distancePricing: boolean;
  flatFee: number;
  freeDeliveryThreshold: number | null;
};

export type DeliveryQuoteResult = {
  available: boolean;
  fee: number;
  free: boolean;
  distanceKm: number;
  message: string;
  bandLabel: string | null;
  courier: string | null;
  freeAboveSubtotal: number | null;
  branchName: string | null;
  fullyStocked: boolean;
};

export type QuotedLine = { productId: number; quantity: number };

/**
 * Live delivery quote for the current pin and basket.
 *
 * The server re-prices the order when it is placed, so this is a preview — but it has
 * to agree with that recalculation, which is why it posts the same basket rather than
 * pricing anything in the browser.
 *
 * Each answer is stored against the request that produced it. A reply for a pin the
 * customer has already dragged away from therefore never lands on screen, and "still
 * calculating" is simply the absence of an answer for the pin showing right now — no
 * separate loading flag to fall out of step with the fee beside it.
 */
export function useDeliveryQuote(input: {
  active: boolean;
  pin: PinnedLocation | null;
  subtotal: number;
  items: QuotedLine[];
}) {
  const itemsKey = JSON.stringify(input.items);
  const key = input.pin
    ? `${input.pin.latitude},${input.pin.longitude}|${input.subtotal}|${itemsKey}`
    : "";
  const [answer, setAnswer] = useState<{ key: string; quote: DeliveryQuoteResult | null } | null>(null);

  const pin = input.pin;
  useEffect(() => {
    if (!input.active || !pin || !key) return;
    const { latitude, longitude } = pin;
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/delivery/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude,
          longitude,
          subtotal: input.subtotal,
          items: JSON.parse(itemsKey) as QuotedLine[],
        }),
      }).catch(() => null);
      const data = response ? await response.json().catch(() => null) : null;
      // A failed preview must not block checkout; the server prices it definitively.
      setAnswer({ key, quote: response?.ok && data ? (data as DeliveryQuoteResult) : null });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [input.active, input.subtotal, itemsKey, key, pin]);

  const settled = answer && answer.key === key ? answer : null;
  return {
    quote: input.active ? (settled?.quote ?? null) : null,
    loading: input.active && Boolean(key) && !settled,
  };
}

export function deliveryFeeOf(
  quote: DeliveryQuoteResult | null,
  options: DeliveryOptions,
  active: boolean,
) {
  if (!active) return 0;
  if (quote) return quote.available ? quote.fee : 0;
  return options.distancePricing ? 0 : options.flatFee;
}
