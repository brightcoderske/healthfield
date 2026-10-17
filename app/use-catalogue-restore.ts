"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Puts the catalogue back where the shopper left it when they return with Back.
 *
 * Opening a product replaces this page, and Back brings it up again from scratch: scrolled to the
 * top, with only the first screenful of products loaded. Someone who scrolled to the fifteenth
 * result and opened it should come back to the fifteenth result, not start the list again.
 *
 * Each browser history entry is tagged with an id in `history.state` the first time the page is
 * shown on it, and the scroll position and number of products loaded are kept in sessionStorage
 * under that id. The tag is what separates "returned with Back or Forward" (the entry already has
 * one, so restore) from "arrived fresh", such as pressing the Home link, which is a new entry with
 * no tag and so opens at the top as it should. Next keeps custom `history.state` on Back/Forward.
 */
const STORAGE_PREFIX = "hf-storefront:";
// A few tries rather than one, because the list may still be filling in (a search is fetched a
// moment after the page appears) and the page cannot scroll further than it is tall.
const RESTORE_ATTEMPTS_MS = [0, 60, 150, 300, 600, 1000, 1600];
const MOST_PRODUCTS = 1000;

type Saved = { y: number; visible: number };

function entryId(create: boolean): string | null {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  if (typeof state.hfEntry === "string") return state.hfEntry;
  if (!create) return null;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  window.history.replaceState({ ...state, hfEntry: id }, "", window.location.href);
  return id;
}

function readSaved(id: string): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + id);
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (!saved || !Number.isFinite(saved.y) || !Number.isFinite(saved.visible)) return null;
    return { y: Math.max(0, Number(saved.y)), visible: Math.max(0, Number(saved.visible)) };
  } catch {
    return null;
  }
}

export function useCatalogueRestore(visibleCount: number, setVisibleCount: (count: number) => void) {
  const visible = useRef(visibleCount);
  // While the saved position is being put back, the scrolling that does it must not be saved as if
  // the shopper had done it.
  const restoring = useRef(false);

  useLayoutEffect(() => {
    visible.current = visibleCount;
  }, [visibleCount]);

  useLayoutEffect(() => {
    const id = entryId(false);
    const saved = id ? readSaved(id) : null;
    if (!saved) return;
    restoring.current = true;
    if (saved.visible > visible.current) setVisibleCount(Math.min(saved.visible, MOST_PRODUCTS));
    let stopped = false;
    const stop = () => {
      stopped = true;
      restoring.current = false;
    };
    // The moment the shopper takes over, stop fighting them.
    const takeover = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    takeover.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
    const timers = RESTORE_ATTEMPTS_MS.map((delay, index) =>
      window.setTimeout(() => {
        if (stopped) return;
        if (Math.abs(window.scrollY - saved.y) > 2) window.scrollTo({ top: saved.y, behavior: "instant" });
        if (index === RESTORE_ATTEMPTS_MS.length - 1) restoring.current = false;
      }, delay),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      takeover.forEach((name) => window.removeEventListener(name, stop));
      restoring.current = false;
    };
    // Once, as the page appears; the position it restores is whatever was saved before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = entryId(true);
    if (!id) return;
    const save = () => {
      if (restoring.current) return;
      try {
        window.sessionStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ y: Math.round(window.scrollY), visible: visible.current }));
      } catch {
        /* storage unavailable (private window, quota): the page simply opens at the top */
      }
    };
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // Pressing a card leaves before the scroll above has settled, so save at the press as well.
    document.addEventListener("click", save, true);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", save, true);
      window.removeEventListener("pagehide", save);
    };
  }, []);
}
