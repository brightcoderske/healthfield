import assert from "node:assert/strict";
import test from "node:test";
import { breakPositions, planBreaks, seededRandom, MIN_PRODUCTS_BEFORE_BREAK, type BreakGuide, type BreakOffer, type BreakProduct, type BreakPromotion } from "./catalogue-breaks.ts";

const product = (id: number, name = `Product ${id}`): BreakProduct => ({ id, name });
const products = (count: number) => Array.from({ length: count }, (_, index) => product(index + 1));
const offer = (id: number, endsAt: string | null = null): BreakOffer => ({
  id, title: `Offer ${id}`, description: null, total: 100, normalTotal: 200, isBundle: false, itemCount: 1, imageUrl: null, endsAt,
});
const guide = (id: number, title = `Guide ${id}`, excerpt = ""): BreakGuide => ({ id, slug: `g${id}`, title, excerpt, imageUrl: null });
const promotion = (id: number): BreakPromotion => ({ id, title: `Promotion ${id}`, imageUrl: `/promotion-${id}.jpg`, productId: id, productName: `Product ${id}` });

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
  const once = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], seed: 99 });
  const twice = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], seed: 99 });
  assert.deepEqual(JSON.stringify(once), JSON.stringify(twice));
});

test("a searching shopper is interrupted at most once", () => {
  const plan = planBreaks({ products: products(60), offers: [offer(1)], guides: [guide(1)], seed: 4, focused: true });
  assert.ok(plan.length <= 1, `focused browsing should not be peppered with cards, got ${plan.length}`);
});

test("no offer, blog, or promotional content means no interruption", () => {
  const plan = planBreaks({ products: products(40), offers: [], guides: [], seed: 3 });
  assert.deepEqual(plan, []);
});

test("the randomizer emits every available storefront interruption type", () => {
  const scenarios = [
    { label: "offers only", offers: [offer(1), offer(2)], guides: [] },
    { label: "blogs only", offers: [], guides: [guide(1), guide(2)] },
    { label: "offers and blogs", offers: [offer(1), offer(2)], guides: [guide(1), guide(2)] },
    { label: "promotions only", offers: [], guides: [], promotions: [promotion(1), promotion(2)] },
    { label: "all types", offers: [offer(1)], guides: [guide(1)], promotions: [promotion(1)] },
  ];
  for (const scenario of scenarios) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const plan = planBreaks({ products: products(60), offers: scenario.offers, guides: scenario.guides, promotions: scenario.promotions || [], seed });
      assert.ok(plan.length > 0, `${scenario.label}, seed ${seed} should produce interruptions`);
      const expected = new Set([scenario.offers.length ? "offer" : "", scenario.guides.length ? "guide" : "", scenario.promotions?.length ? "promotion" : ""].filter(Boolean));
      assert.ok(plan.every((entry) => expected.has(entry.item.kind)), `${scenario.label}, seed ${seed} emitted a kind without content`);
    }
  }
});

test("every promotional interruption carries all adverts and rotates its lead", () => {
  const adverts = [promotion(1), promotion(2), promotion(3)];
  const plan = planBreaks({ products: products(80), offers: [], guides: [], promotions: adverts, seed: 23 });
  const promotionBreaks = plan.filter((entry) => entry.item.kind === "promotion");
  assert.ok(promotionBreaks.length > 1);
  for (const entry of promotionBreaks) {
    if (entry.item.kind !== "promotion") continue;
    assert.equal(entry.item.promotions.length, adverts.length);
    assert.equal(new Set(entry.item.promotions.map((item) => item.id)).size, adverts.length);
    assert.equal(entry.item.promotion.id, entry.item.promotions[0]?.id);
  }
  const first = promotionBreaks[0]?.item;
  const second = promotionBreaks[1]?.item;
  assert.ok(first?.kind === "promotion" && second?.kind === "promotion" && first.promotion.id !== second.promotion.id);
});

test("offers closest to expiry are shown first", () => {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const plan = planBreaks({ products: products(60), offers: [offer(1, later), offer(2, soon)], guides: [], seed: 5 });
  const firstOffer = plan.find((entry) => entry.item.kind === "offer");
  assert.equal(firstOffer && firstOffer.item.kind === "offer" && firstOffer.item.offer.id, 2, "the offer about to end should lead");
});

test("a guide that matches what is on screen wins over one that does not", () => {
  const catalogue = [product(1, "Cetirizine Allergy Relief"), ...products(40).slice(1)];
  const plan = planBreaks({
    products: catalogue,
    offers: [],
    guides: [guide(1, "Sleep and rest"), guide(2, "Managing allergy season", "cetirizine and antihistamines")],
    seed: 11,
  });
  const firstGuide = plan.find((entry) => entry.item.kind === "guide");
  assert.equal(firstGuide && firstGuide.item.kind === "guide" && firstGuide.item.guide.id, 2, "the relevant guide should lead");
});

test("every blog interruption carries the full collection and rotates its lead", () => {
  const catalogueGuides = [guide(1), guide(2), guide(3), guide(4)];
  const plan = planBreaks({ products: products(60), offers: [], guides: catalogueGuides, seed: 17 });
  const guideBreaks = plan.filter((entry) => entry.item.kind === "guide");
  assert.ok(guideBreaks.length > 1, "a long catalogue should contain multiple blog interruptions");
  for (const entry of guideBreaks) {
    if (entry.item.kind !== "guide") continue;
    assert.equal(entry.item.guides.length, catalogueGuides.length, "each rail should include every available blog");
    assert.equal(new Set(entry.item.guides.map((item) => item.id)).size, catalogueGuides.length, "a blog must not repeat within one rail");
    assert.equal(entry.item.guide.id, entry.item.guides[0]?.id, "the lead blog should be the first card in its rail");
  }
  const first = guideBreaks[0]?.item;
  const second = guideBreaks[1]?.item;
  assert.ok(first?.kind === "guide" && second?.kind === "guide" && first.guide.id !== second.guide.id, "later rails should rotate the lead blog");
});
