"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  draftAge,
  draftDiffers,
  draftKey,
  readDraft,
  writeDraft,
  type DraftKind,
} from "@/lib/editor-drafts";

/** Long enough that a fast typist is not writing to storage on every letter. */
const SAVE_AFTER_IDLE_MS = 900;

/**
 * Keeps a silent local copy of whatever is being edited.
 *
 * Nothing here blocks typing: the value is captured on a trailing debounce and written
 * to local storage, which is synchronous and cheap, so a keystroke is never waiting on
 * it. Nothing is sent to the server — the draft exists to survive a keyboard, a back
 * gesture or a dropped connection, not to publish anything.
 */
export function useEditorDraft<T extends Record<string, unknown>>(input: {
  kind: DraftKind;
  id: number | "new" | null;
  /** Current form values, recomputed by the caller as the user types. */
  values: T | null;
  /** What the record looked like when it was opened, to spot a real difference. */
  baseline: T | null;
  /** Fields that should never trigger a restore prompt on their own. */
  ignore?: string[];
}) {
  const key = draftKey(input.kind, input.id);
  const [recovered, setRecovered] = useState<{ values: T; age: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const store = typeof window === "undefined" ? null : window.localStorage;
  const openedKey = useRef<string | null>(null);
  const ignore = input.ignore;

  // Look for an interrupted draft once per record opened. Deferred to a task rather
  // than run inline: setting state straight from an effect body cascades a render, and
  // this only ever needs to land before the person can read the form anyway.
  useEffect(() => {
    if (!store || openedKey.current === key) return;
    openedKey.current = key;
    const baseline = input.baseline;
    const timer = window.setTimeout(() => {
      setRecovered(null);
      setSavedAt(null);
      const found = readDraft<T>(store, key);
      if (!found) return;
      // A draft matching what is already on screen is noise, not a recovery.
      if (baseline && !draftDiffers(found.values, baseline, ignore)) {
        clearDraft(store, key);
        return;
      }
      setRecovered({ values: found.values, age: draftAge(found.savedAt) });
    }, 0);
    return () => window.clearTimeout(timer);
    // baseline is read only at open; later edits must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store]);

  const serialised = input.values ? JSON.stringify(input.values) : null;

  useEffect(() => {
    if (!store || !serialised || !input.baseline) return;
    const timer = window.setTimeout(() => {
      const values = JSON.parse(serialised) as T;
      // Only worth keeping once it differs from what was opened.
      if (!draftDiffers(values, input.baseline as T, ignore)) {
        clearDraft(store, key);
        setSavedAt(null);
        return;
      }
      if (writeDraft(store, key, values)) setSavedAt(Date.now());
    }, SAVE_AFTER_IDLE_MS);
    return () => window.clearTimeout(timer);
    // baseline is a stable snapshot for the open record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, key, store]);

  /** Call after a successful save, so the recovery copy does not linger. */
  const discard = useCallback(() => {
    if (store) clearDraft(store, key);
    setRecovered(null);
    setSavedAt(null);
  }, [store, key]);

  const dismiss = useCallback(() => setRecovered(null), []);

  return { recovered, savedAt, discard, dismiss };
}
