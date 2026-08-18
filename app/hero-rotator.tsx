"use client";

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

const SLIDE_MS = 7000;

/**
 * Cross-fades the storefront hero between its slides.
 *
 * Every slide stays mounted and stacked, so switching is a class change rather than a
 * remount — an image that has already been fetched is never fetched again, and the
 * panel cannot change height mid-rotation.
 *
 * Rotation stops while a pointer is over the hero or focus is inside it, so it cannot
 * move out from under someone reading it or tabbing to the call to action. A visitor
 * who prefers reduced motion is left on the first slide and given the dots.
 */
export function HeroRotator({ children }: { children: ReactNode }) {
  const slides = Children.toArray(children);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % slides.length), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [slides.length, paused]);

  return (
    <div
      className="hero-rotator"
      ref={container}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!container.current?.contains(event.relatedTarget as Node)) setPaused(false);
      }}
    >
      {slides.map((slide, index) => (
        <div
          className={`hero-slide-frame ${index === active ? "active" : ""}`}
          key={index}
          // The hidden slides are inert rather than merely transparent, so a keyboard
          // never lands on a link the visitor cannot see.
          aria-hidden={index !== active}
          inert={index !== active}
        >
          {slide}
        </div>
      ))}
      {slides.length > 1 ? (
        <div className="hero-dots" role="tablist" aria-label="Featured panels">
          {slides.map((_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Show panel ${index + 1}`}
              className={index === active ? "active" : ""}
              onClick={() => setActive(index)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
