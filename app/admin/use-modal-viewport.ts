"use client";

import { useEffect } from "react";

/** Below this the shrinking is browser chrome retracting, not a keyboard opening. */
const KEYBOARD_THRESHOLD_PX = 120;

/**
 * Keeps an open editor modal inside the part of the screen a phone is actually showing.
 *
 * `100vh`, and even `100dvh`, describe the layout viewport: neither shrinks when the
 * on-screen keyboard opens, so a modal sized in those units runs on underneath it and
 * takes the Save button with it. The *visual* viewport is the measurement that tracks
 * both the browser's bars and the keyboard, so it is published here as CSS variables
 * for editor-modal-mobile.css to size against, and refreshed whenever it changes.
 *
 * The focused field is also scrolled back into view. A keyboard opening does not move
 * the caret on its own; without this, typing into the last field on a long form means
 * typing into something hidden behind the keys.
 */
export function useModalViewport(open: boolean) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const root = document.documentElement;
    const viewport = window.visualViewport;

    function apply() {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      // What the keyboard, or a bar the browser has not retracted, is covering.
      const covered = Math.max(0, window.innerHeight - height - offsetTop);
      root.style.setProperty("--editor-viewport", `${Math.round(height)}px`);
      root.style.setProperty("--editor-viewport-top", `${Math.round(offsetTop)}px`);
      root.classList.toggle("keyboard-open", covered > KEYBOARD_THRESHOLD_PX);
    }

    /**
     * Waits for the keyboard animation to finish before scrolling, because the visual
     * viewport is still moving while it slides up and an earlier scroll lands short.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;
    function reveal(event: FocusEvent) {
      const field = event.target as HTMLElement | null;
      if (!field?.closest?.(".blog-modal, .product-modal")) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const box = field.getBoundingClientRect();
        const visible = viewport?.height ?? window.innerHeight;
        // Only when it is genuinely out of sight: an unnecessary scroll on every tap
        // makes a form feel like it is fighting back.
        if (box.top < 0 || box.bottom > visible) field.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 320);
    }

    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    document.addEventListener("focusin", reveal);
    // The page behind a full-screen sheet must not scroll with it, or closing the
    // modal leaves the list somewhere the person did not put it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(timer);
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
      document.removeEventListener("focusin", reveal);
      document.body.style.overflow = previousOverflow;
      root.style.removeProperty("--editor-viewport");
      root.style.removeProperty("--editor-viewport-top");
      root.classList.remove("keyboard-open");
    };
  }, [open]);
}
