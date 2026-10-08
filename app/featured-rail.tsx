"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { FEATURED_VISIBLE, featuredWindow } from "@/lib/featured-products";

/** How long one screenful of featured products stays up before the next takes its place. */
const ROTATE_MS = 9000;

/**
 * The featured products, a screenful at a time.
 *
 * The admin can keep up to thirty products on the featured shelf, but thirty cards at once
 * would push the rest of the page out of sight. This shows FEATURED_VISIBLE and swaps in
 * the next batch on a timer, wrapping round, so every featured product gets its turn.
 *
 * It holds still while the visitor is hovering, touching or tabbing through it, while the
 * tab is in the background, and for anyone who asked for reduced motion — a card that
 * changes under a thumb that was about to tap it is worse than no rotation at all.
 */
export function FeaturedRail<T extends { id: number }>({
  items,
  startStep = 0,
  children,
}: {
  items: T[];
  /** Which batch to open on, so two visitors do not always start on the same one. */
  startStep?: number;
  children: (item: T) => ReactNode;
}) {
  const [step, setStep] = useState(startStep);
  const held = useRef(false);
  const rotates = items.length > FEATURED_VISIBLE;

  useEffect(() => {
    if (!rotates || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (held.current || document.hidden) return;
      setStep((current) => current + 1);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotates]);

  const shown = featuredWindow(items, step);
  return (
    <section className="approved-section featured-rail" aria-label="Featured products">
      <div className="approved-title">
        <div>
          <h2>Featured products</h2>
        </div>
      </div>
      <div
        // Keyed by the batch so each swap replays the fade-in rather than snapping.
        key={rotates ? (step % Math.ceil(items.length / FEATURED_VISIBLE)) : 0}
        className={`approved-products featured-rail-grid${rotates ? " is-rotating" : ""}`}
        onPointerEnter={() => { held.current = true; }}
        onPointerLeave={() => { held.current = false; }}
        onFocus={() => { held.current = true; }}
        onBlur={() => { held.current = false; }}
        onTouchStart={() => { held.current = true; }}
        onTouchEnd={() => { window.setTimeout(() => { held.current = false; }, ROTATE_MS); }}
      >
        {shown.map((item) => children(item))}
      </div>
    </section>
  );
}
