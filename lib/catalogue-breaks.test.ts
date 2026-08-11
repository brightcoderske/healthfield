import assert from "node:assert/strict";
import test from "node:test";
import { breakPositions, planBreaks, seededRandom, MIN_PRODUCTS_BEFORE_BREAK, type BreakGuide, type BreakOffer, type BreakProduct } from "./catalogue-breaks.ts";

const product = (id: number, over: Partial<BreakProduct> = {}): BreakProduct => ({
  id, name: `Product ${id}`, imageUrl: null, price: 100, discountPrice: null, categoryId: 1, conditionIds: [], ...over,
});
const products = (count: number) => Array.from({ length: count }, (_, index) => product(index + 1));
const offer = (id: number, endsAt: string | null = null): BreakOffer => ({
  id, title: `Offer ${id}`, description: null, total: 100, normalTotal: 200, isBundle: false, itemCount: 1, imageUrl: null, endsAt,
});
const guide = (id: number, title = `Guide ${id}`, excerpt = ""): BreakGuide => ({ id, slug: `g${id}`, title, excerpt, imageUrl: null });

test("a catalogue too short to interrupt is left alone", () => {
  for (const count of [0, 1, 3, MIN_PRODUCTS_BEFORE_BREAK * 2 - 1]) {
    assert.deepEqual(breakPositions(count, { random: seededRandom(1) }), [], `count ${count}`);
  }
});

test("breaks never sit at the start, never strand a single trailing product", () => {
  for (let count = 6; count <= 60; count += 1) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const positions = breakPositions(count, { random: seededRandom(seed) });
      for (const position of positions) {
        assert.ok(position >= MIN_PRODUCTS_BEFORE_BREAK, `count ${count} seed ${seed}: break at ${position} is too early`);
        assert.ok(position < count - 1, `count ${count} seed ${seed}: break at ${position} strands the tail`);
      }
      const ascending = positions.every((value, index) => index === 0 || value > positions[index - 1]);
      assert.ok(ascending, `count ${count} seed ${seed}: positions must ascend`);
      assert.equal(new Set(positions).size, positions.length, "no duplicate positions");
    }
  }
});

test("gaps vary rather than repeating a fixed rhythm", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 25; seed += 1) seen.add(breakPositions(48, { random: seededRandom(seed) }).join(","));
  assert.ok(seen.size > 5, `expected varied layouts across seeds, saw ${seen.size}`);

  const gaps = new Set<number>();
  const positions = breakPositions(120, { random: seededRandom(7) });
  positions.forEach((value, index) => gaps.add(index === 0 ? value : value - positions[index - 1]));
  assert.ok(gaps.size > 1, "a single catalogue should not use one identical gap throughout");
});

test("the same seed always produces the same layout", () => {
  // Server render and client hydration must agree or React tears the page down.
  const once = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], conditions: [], seed: 99 });
  const twice = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], conditions: [], seed: 99 });
  assert.deepEqual(JSON.stringify(once), JSON.stringify(twice));
});

test("a searching shopper is interrupted at most once", () => {
  const plan = planBreaks({ products: products(60), offers: [offer(1)], guides: [guide(1)], conditions: [], seed: 4, focused: true });
  assert.ok(plan.length <= 1, `focused browsing should not be peppered with cards, got ${plan.length}`);
});

test("only kinds with content behind them are used", () => {
  const plan = planBreaks({ products: products(40), offers: [], guides: [], conditions: [], seed: 3 });
  assert.ok(plan.length > 0, "product recommendations should still fill the breaks");
  assert.ok(plan.every((entry) => entry.item.kind === "product"), "no empty offer or guide cards");
});

test("offers closest to expiry are shown first", () => {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const plan = planBreaks({ products: products(60), offers: [offer(1, later), offer(2, soon)], guides: [], conditions: [], seed: 5 });
  const firstOffer = plan.find((entry) => entry.item.kind === "offer");
  assert.equal(firstOffer && firstOffer.item.kind === "offer" && firstOffer.item.offer.id, 2, "the offer about to end should lead");
});

test("a guide that matches what is on screen wins over one that does not", () => {
  const catalogue = [product(1, { name: "Cetirizine Allergy Relief" }), ...products(40).slice(1)];
  const plan = planBreaks({
    products: catalogue,
    offers: [],
    guides: [guide(1, "Sleep and rest"), guide(2, "Managing allergy season", "cetirizine and antihistamines")],
    conditions: [],
    seed: 11,
  });
  const firstGuide = plan.find((entry) => entry.item.kind === "guide");
  assert.equal(firstGuide && firstGuide.item.kind === "guide" && firstGuide.item.guide.id, 2, "the relevant guide should lead");
});

test("a recommendation is never a product already scrolled past, and never repeats", () => {
  const plan = planBreaks({ products: products(60), offers: [], guides: [], conditions: [], seed: 8 });
  const recommended = plan.filter((entry) => entry.item.kind === "product");
  const ids = recommended.map((entry) => entry.item.kind === "product" && entry.item.product.id);
  assert.equal(new Set(ids).size, ids.length, "the same product should not be recommended twice");
  for (const entry of recommended) {
    if (entry.item.kind !== "product") continue;
    const indexOfProduct = 60 - (60 - entry.item.product.id) - 1;
    assert.ok(indexOfProduct >= entry.position, `product ${entry.item.product.id} sits above the break at ${entry.position}`);
  }
});

test("the hook only names a condition the surrounding shelf actually shares", () => {
  // Regression: a card headlined "Pregnancy?" over a cold-and-flu shelf because it
  // read the recommended product's own first condition instead of a shared one.
  const COLD = 1, PREGNANCY = 2;
  const shelf = Array.from({ length: 40 }, (_, index) =>
    product(index + 1, { categoryId: 1, conditionIds: [COLD] }));
  // The only candidate left is unrelated to everything on the shelf.
  const odd = product(99, { name: "Prenatal Vitamins", categoryId: 9, conditionIds: [PREGNANCY] });
  const plan = planBreaks({
    products: [...shelf, odd],
    offers: [], guides: [],
    conditions: [{ id: COLD, name: "Cold & Flu" }, { id: PREGNANCY, name: "Pregnancy" }],
    seed: 21,
  });
  for (const entry of plan) {
    if (entry.item.kind !== "product") continue;
    const { product: shown, conditionName } = entry.item;
    if (conditionName === null) continue;
    const shownConditions = shown.conditionIds;
    assert.ok(shownConditions.includes(COLD) || conditionName !== "Pregnancy",
      `a "${conditionName}" hook must not headline a shelf that does not share it`);
  }
  // And a product sharing nothing with the shelf never claims a condition.
  const oddEntry = plan.find((entry) => entry.item.kind === "product" && entry.item.product.id === 99);
  if (oddEntry && oddEntry.item.kind === "product") {
    assert.equal(oddEntry.item.product.conditionName, null, "an unrelated product must use the neutral hook");
  }
});
