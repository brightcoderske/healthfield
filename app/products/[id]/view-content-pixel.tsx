"use client";

import { useEffect, useRef } from "react";
import { trackViewContent } from "@/lib/meta-pixel";

/** Fires once per product page view. A leaf component so the page above it stays a server component. */
export function ViewContentPixel({
  productId,
  productName,
  value,
}: {
  productId: number;
  productName: string;
  value: number;
}) {
  const tracked = useRef<number | null>(null);
  useEffect(() => {
    if (tracked.current === productId) return;
    tracked.current = productId;
    trackViewContent({ contentId: productId, contentName: productName, value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  return null;
}
