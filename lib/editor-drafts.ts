/**
 * Local recovery for half-finished admin forms.
 *
 * Editing happens in a modal, often on a phone, where the on-screen keyboard, a back
 * gesture or a dropped connection can take the form away mid-sentence. Losing a long
 * product description to any of those is the difference between a tool people trust and
 * one they work around.
 *
 * Deliberately local storage, not the server: a draft is recovery for the person who
 * typed it, not a record anyone else should see. Publishing state stays an explicit
 * choice made with the Save controls.
 *
 * Written without constructor parameter properties or enums: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export type DraftKind = "product" | "blog";

/** Anything older than this is assumed abandoned rather than interrupted. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredDraft<T> = { savedAt: number; values: T };

/** Minimal shape of Storage, so the behaviour can be tested without a browser. */
export type DraftStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * The key a draft lives under.
 *
 * A new item and an existing one are kept apart, and each existing item keeps its own
 * slot, so recovering one record can never overwrite another.
 */
export function draftKey(kind: DraftKind, id: number | "new" | null | undefined) {
  return `healthfield:draft:${kind}:${id === null || id === undefined ? "new" : id}`;
}

export function writeDraft<T>(store: DraftStore, key: string, values: T, now = Date.now()) {
  try {
    store.setItem(key, JSON.stringify({ savedAt: now, values }));
    return true;
  } catch {
    // A full or disabled storage must never interrupt typing.
    return false;
  }
}

export function clearDraft(store: DraftStore, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do; a stale draft is only ever offered, never applied silently.
  }
}

/**
 * Reads a draft back, ignoring anything stale or corrupt.
 *
 * Returns null rather than throwing on malformed JSON: a broken draft should quietly
 * not exist, not break the form it was meant to protect.
 */
export function readDraft<T>(store: DraftStore, key: string, now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS): StoredDraft<T> | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== "number" || !("values" in parsed)) return null;
    if (now - parsed.savedAt > maxAgeMs) {
      clearDraft(store, key);
      return null;
    }
    return parsed;
  } catch {
    clearDraft(store, key);
    return null;
  }
}

/**
 * Whether a draft is worth offering to restore.
 *
 * A draft identical to what the form already shows is noise — the prompt would appear
 * every time someone opened a record they had merely looked at before.
 */
export function draftDiffers<T extends Record<string, unknown>>(draft: T, current: T, ignore: string[] = []) {
  const skip = new Set(ignore);
  const keys = new Set([...Object.keys(draft), ...Object.keys(current)].filter((key) => !skip.has(key)));
  for (const key of keys) {
    const a = draft[key];
    const b = current[key];
    if (typeof a === "object" || typeof b === "object") {
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) return true;
      continue;
    }
    // Blank and absent mean the same thing in a form; treating them as different would
    // offer a restore for a field nobody touched.
    if ((a ?? "") !== (b ?? "")) return true;
  }
  return false;
}

/** How long ago the draft was taken, phrased for a recovery prompt. */
export function draftAge(savedAt: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return "moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
