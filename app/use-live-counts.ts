"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type NavigationCounts = {
  newOrders: number;
  newChats?: number;
  unmatchedPayments?: number;
  pendingPrescriptions?: number;
  pendingConsultations?: number;
};

const MUTE_KEY = "healthfield:alert-muted";

// The mute preference lives in localStorage rather than React state so it survives
// navigation, and is read through useSyncExternalStore so a change in one tab
// silences every other tab the same person has open.
const muteListeners = new Set<() => void>();

function subscribeMute(callback: () => void) {
  muteListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    muteListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readMuted() {
  return window.localStorage.getItem(MUTE_KEY) === "true";
}

// The server cannot know the preference, so it renders as unmuted.
function serverMuted() {
  return false;
}

function writeMuted(next: boolean) {
  window.localStorage.setItem(MUTE_KEY, String(next));
  for (const listener of muteListeners) listener();
}

const POLL_MS = 30_000;

function total(counts: NavigationCounts) {
  return (
    (counts.newOrders || 0) +
    (counts.newChats || 0) +
    (counts.unmatchedPayments || 0) +
    (counts.pendingPrescriptions || 0) +
    (counts.pendingConsultations || 0)
  );
}

// The chime is synthesised rather than loaded from a file: no extra asset to ship,
// nothing for a content policy to block, and it stays audible on a noisy counter.
function playChime(context: AudioContext) {
  const now = context.currentTime;
  for (const [index, frequency] of [880, 1174.7].entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * 0.14;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  }
}

/**
 * Keeps the sidebar badges live and announces genuinely new work.
 *
 * Three deliberate constraints: polling pauses while the tab is hidden so idle
 * browsers do not hammer the API all day; the chime fires only when a count rises,
 * never on a refresh that returns the same number; and the audio context is unlocked
 * on the first interaction because browsers refuse to play sound before one.
 */
export function useLiveCounts(initial: NavigationCounts, endpoint: string) {
  const [counts, setCounts] = useState(initial);
  const muted = useSyncExternalStore(subscribeMute, readMuted, serverMuted);
  const previous = useRef(initial);
  const audio = useRef<AudioContext | null>(null);

  const toggleMute = useCallback(() => writeMuted(!readMuted()), []);

  // Browsers block audio until the page has been interacted with, so the context is
  // created on the first gesture and reused from then on.
  useEffect(() => {
    const unlock = () => {
      if (audio.current) return;
      const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context) audio.current = new Context();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const next = (await response.json()) as NavigationCounts;
        if (cancelled || typeof next?.newOrders !== "number") return;
        const rose = total(next) > total(previous.current);
        previous.current = next;
        setCounts(next);
        if (rose && !readMuted() && audio.current) {
          if (audio.current.state === "suspended") void audio.current.resume();
          playChime(audio.current);
        }
      } catch {
        // A dropped poll is not worth surfacing; the next one will catch up.
      }
    }

    function schedule() {
      if (cancelled) return;
      timer = window.setTimeout(() => void check().finally(schedule), POLL_MS);
    }

    // A tab returning to the foreground checks immediately rather than waiting.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endpoint]);

  // The browser tab is where this is noticed when the window is behind another.
  useEffect(() => {
    const outstanding = total(counts);
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = outstanding > 0 ? `(${outstanding}) ${base}` : base;
  }, [counts]);

  return { counts, muted, toggleMute };
}
