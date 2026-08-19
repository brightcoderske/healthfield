import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_MAX_AGE_MS,
  clearDraft,
  draftAge,
  draftDiffers,
  draftKey,
  readDraft,
  writeDraft,
  type DraftStore,
} from "./editor-drafts.ts";

function memoryStore(seed: Record<string, string> = {}): DraftStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
    removeItem: (key) => { delete data[key]; },
  };
}

test("each record keeps its own draft slot", () => {
  // Recovering one product must never overwrite another, and a new item is separate
  // from every existing one.
  assert.equal(draftKey("product", 12), "healthfield:draft:product:12");
  assert.equal(draftKey("product", "new"), "healthfield:draft:product:new");
  assert.equal(draftKey("product", null), "healthfield:draft:product:new");
  assert.equal(draftKey("blog", 3), "healthfield:draft:blog:3");
  assert.notEqual(draftKey("product", 3), draftKey("blog", 3));
});

test("a draft survives a round trip", () => {
  const store = memoryStore();
  const key = draftKey("product", "new");
  writeDraft(store, key, { name: "Panadol", price: 100 }, 1_000);
  const back = readDraft<{ name: string; price: number }>(store, key, 2_000);
  assert.equal(back?.values.name, "Panadol");
  assert.equal(back?.savedAt, 1_000);
});

test("a stale draft is discarded rather than offered", () => {
  const store = memoryStore();
  const key = draftKey("blog", 1);
  writeDraft(store, key, { title: "Old" }, 0);
  assert.equal(readDraft(store, key, DRAFT_MAX_AGE_MS + 1), null);
  // It is also cleaned up, so it cannot be offered again later.
  assert.equal(store.getItem(key), null);
});

test("a corrupt draft quietly does not exist", () => {
  // A broken draft must not break the form it was meant to protect.
  const store = memoryStore({ "healthfield:draft:blog:2": "{not json" });
  assert.equal(readDraft(store, "healthfield:draft:blog:2"), null);
  const wrongShape = memoryStore({ "healthfield:draft:blog:2": JSON.stringify({ nope: true }) });
  assert.equal(readDraft(wrongShape, "healthfield:draft:blog:2"), null);
});

test("storage failure never interrupts typing", () => {
  // Private browsing and full quotas both throw on setItem; losing the safety net is
  // acceptable, losing the keystroke is not.
  const hostile: DraftStore = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("full"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  assert.equal(writeDraft(hostile, "k", { a: 1 }), false);
  assert.equal(readDraft(hostile, "k"), null);
  assert.doesNotThrow(() => clearDraft(hostile, "k"));
});

test("an unchanged draft is not worth offering", () => {
  const current = { name: "Panadol", description: "<p>Hello</p>", price: "100" };
  assert.equal(draftDiffers({ ...current }, current), false);
  assert.equal(draftDiffers({ ...current, name: "Panadol Extra" }, current), true);
});

test("blank and absent count as the same, so untouched fields raise no prompt", () => {
  assert.equal(draftDiffers({ name: "A", brand: "" }, { name: "A" } as Record<string, unknown>), false);
  assert.equal(draftDiffers({ name: "A", brand: undefined }, { name: "A", brand: "" }), false);
  assert.equal(draftDiffers({ name: "A", brand: "Bayer" }, { name: "A", brand: "" }), true);
});

test("nested values are compared by content, and ignored fields skipped", () => {
  assert.equal(draftDiffers({ ids: [1, 2] }, { ids: [1, 2] }), false);
  assert.equal(draftDiffers({ ids: [1, 2] }, { ids: [2, 1] }), true);
  assert.equal(draftDiffers({ name: "A", savedAt: 1 }, { name: "A", savedAt: 2 }, ["savedAt"]), false);
});

test("the prompt says how old the draft is in words", () => {
  const now = 1_000_000_000;
  assert.equal(draftAge(now - 5_000, now), "moments ago");
  assert.equal(draftAge(now - 60_000, now), "1 minute ago");
  assert.equal(draftAge(now - 600_000, now), "10 minutes ago");
  assert.equal(draftAge(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(draftAge(now - 2 * 86_400_000, now), "2 days ago");
});
