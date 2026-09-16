"use client";

import { useEffect, useRef } from "react";

/** How long a slide holds before the rail moves on. */
const ROTATE_MS = 3000;
/** How long a rail stays still after someone has swiped it themselves. */
const RESUME_AFTER_TOUCH_MS = 8000;

/**
 * Auto-advances a horizontal scroll-snap rail, one card at a time, looping back to the
 * start when it reaches the end.
 *
 * The rails were already swipeable — they just never moved on their own, so the second
 * and third offer went unseen by anyone who did not think to swipe. This adds the
 * movement without taking the swipe away: a rail the visitor is touching, hovering,
 * or tabbing through stops, and one they have swiped themselves stays put for a while
 * afterwards rather than yanking itself back a moment later.
 *
 * It also stops while the rail is off screen or the tab is in the background, so a long
 * homepage is not running a dozen timers and smooth-scrolls nobody can see, and it does
 * nothing at all for a visitor who asked for reduced motion.
 */
export function useAutoRotate<T extends HTMLElement>(count: number, intervalMs = ROTATE_MS) {
  const rail = useRef<T>(null);
  // Held in a ref rather than state: these change on every pointer move and hover, and
  // none of them should cost the catalogue a re-render.
  const holdUntil = useRef(0);
  const hovering = useRef(false);

  useEffect(() => {
    const element = rail.current;
    if (!element || count < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Whether the rail is on screen is read at each tick rather than watched. It is one
    // rect per rail every few seconds, and it cannot get stuck the way a subscription
    // can when a callback is missed.
    const onScreen = () => {
      const box = element.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
    };

    const hold = () => {
      holdUntil.current = Date.now() + RESUME_AFTER_TOUCH_MS;
    };
    const enter = () => {
      hovering.current = true;
    };
    const leave = () => {
      hovering.current = false;
    };

    element.addEventListener("pointerdown", hold);
    element.addEventListener("touchstart", hold, { passive: true });
    element.addEventListener("wheel", hold, { passive: true });
    element.addEventListener("mouseenter", enter);
    element.addEventListener("mouseleave", leave);
    const blur = (event: FocusEvent) => {
      if (!element.contains(event.relatedTarget as Node)) leave();
    };
    element.addEventListener("focusin", enter);
    element.addEventListener("focusout", blur);

    const step = () => {
      if (hovering.current || document.hidden || !onScreen()) return;
      if (Date.now() < holdUntil.current) return;
      const card = element.firstElementChild as HTMLElement | null;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap || "0") || 0;
      const distance = (card?.offsetWidth ?? element.clientWidth) + gap;
      const atEnd = element.scrollLeft >= element.scrollWidth - element.clientWidth - 2;
      // Looping by scrolling back rather than by reordering the cards: the DOM order is
      // the plan the server rendered, and it stays that way.
      element.scrollTo({ left: atEnd ? 0 : element.scrollLeft + distance, behavior: "smooth" });
    };

    const timer = window.setInterval(step, intervalMs);
    return () => {
      window.clearInterval(timer);
      element.removeEventListener("pointerdown", hold);
      element.removeEventListener("touchstart", hold);
      element.removeEventListener("wheel", hold);
      element.removeEventListener("mouseenter", enter);
      element.removeEventListener("mouseleave", leave);
      element.removeEventListener("focusin", enter);
      element.removeEventListener("focusout", blur);
    };
  }, [count, intervalMs]);

  return rail;
}
