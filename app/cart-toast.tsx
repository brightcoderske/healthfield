"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const CART_ADDED_EVENT = "healthfield:cart-added";
const VISIBLE_MS = 2000;

/** Announces a successful add. Called from wherever something went into the basket. */
export function announceCartAdded() {
  window.dispatchEvent(new Event(CART_ADDED_EVENT));
}

/**
 * The small "Added to cart" note, with a way straight to checkout.
 *
 * Mounted once for the whole site and driven by an event, so the grid, the option
 * picker and the product page all show the same note without each carrying its own.
 * It leaves after two seconds — but not while a pointer or keyboard focus is on it, or
 * the Checkout button would disappear from under the person reaching for it.
 */
export function CartToast() {
  const [visible, setVisible] = useState(false);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hideLater = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!held.current) setVisible(false);
      }, VISIBLE_MS);
    };
    const show = () => {
      setVisible(true);
      hideLater();
    };
    window.addEventListener(CART_ADDED_EVENT, show);
    return () => {
      window.removeEventListener(CART_ADDED_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!visible) return null;

  const hold = () => {
    held.current = true;
  };
  const release = () => {
    held.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  };

  return (
    <div
      className="cart-toast"
      role="status"
      aria-live="polite"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <Check aria-hidden="true" />
      <span>Added to cart</span>
      <Link prefetch={false} href="/checkout" onClick={() => setVisible(false)}>
        Checkout
      </Link>
    </div>
  );
}
