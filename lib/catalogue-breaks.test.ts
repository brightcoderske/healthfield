import assert from "node:assert/strict";
import test from "node:test";
import { breakPositions, planBreaks, type BreakGuide, type BreakOffer, type BreakProduct, type BreakPromotion } from "./catalogue-breaks.ts";
import { offerTilePresentation, type OfferTeaserProduct } from "./offer-teaser.ts";

const product = (id: number, name = `Product ${id}`): BreakProduct => ({ id, name });
const products = (count: number) => Array.from({ length: count }, (_, index) => product(index + 1));
const offer = (id: number, endsAt: string | null = null): BreakOffer => ({
  id, title: `Offer ${id}`, slug: `offer-${id}`, description: null, total: 100, normalTotal: 200, isBundle: false, itemCount: 1, imageUrl: null, endsAt,
  items: [{ productId: id, imageUrl: null, quantity: 1 }],
});
const guide = (id: number, title = `Guide ${id}`, excerpt = ""): BreakGuide => ({ id, slug: `g${id}`, title, excerpt, imageUrl: null });
const promotion = (id: number): BreakPromotion => ({ id, title: `Promotion ${id}`, imageUrl: `/promotion-${id}.jpg`, productId: id, productName: `Product ${id}` });

test("offer image tiles adapt from one product through the compact overflow layout", () => {
  const items = (count: number): OfferTeaserProduct[] => Array.from({ length: count }, (_, index) => ({
    productId: index + 1,
    imageUrl: index === 1 ? null : `/product-${index + 1}.jpg`,
    quantity: index === 0 ? 2 : 1,
  }));

  assert.deepEqual(offerTilePresentation(items(1)), { tiles: items(1), layout: "one", remaining: 0 });
  assert.equal(offerTilePresentation(items(2)).layout, "two");
  assert.equal(offerTilePresentation(items(3)).layout, "three");
  assert.equal(offerTilePresentation(items(4)).layout, "four");

  const seven = offerTilePresentation(items(7));
  assert.equal(seven.layout, "four");
  assert.equal(seven.tiles.length, 4);
  assert.equal(seven.remaining, 3);
  assert.equal(seven.tiles[1]?.imageUrl, null, "products without artwork remain represented by a placeholder tile");
});

const SCREENS = [{ label: "phone", columns: 2 }, { label: "tablet", columns: 3 }, { label: "laptop", columns: 4 }, { label: "wide laptop", columns: 5 }, { label: "ultra-wide", columns: 6 }];

test("a break comes after every two full rows, whatever the screen", () => {
  for (const { label, columns } of SCREENS) {
    const perBreak = columns * 2;
    for (let count = 0; count <= 120; count += 1) {
      const positions = breakPositions(count, columns);
      const expected = Array.from({ length: Math.max(0, Math.ceil(count / perBreak) - 1) }, (_, index) => (index + 1) * perBreak);
      assert.deepEqual(positions, expected, `${label}: ${count} products`);
      // Rows are counted between cards: never more than two products-rows in a row.
      positions.forEach((position, index) => assert.equal(position - (positions[index - 1] ?? 0), perBreak, `${label}: gap before break ${index + 1}`));
      // A card always has a product after it, and the first run is also two rows.
      assert.ok(positions.every((position) => position < count), `${label}: a card must not be the last thing`);
    }
  }
});

test("a catalogue of two rows or fewer is left alone", () => {
  for (const { columns } of SCREENS) {
    for (const count of [0, 1, columns, columns * 2]) assert.deepEqual(breakPositions(count, columns), [], `${columns} columns, ${count} products`);
    assert.deepEqual(breakPositions(columns * 2 + 1, columns), [columns * 2]);
  }
});

test("a bad column count can never switch the breaks off or stretch the gap", () => {
  for (const columns of [0, -3, 0.4, Number.NaN]) {
    const positions = breakPositions(40, Math.max(1, columns || 1));
    assert.ok(positions.length >= 19, `columns ${columns} gave ${positions.length} breaks`);
  }
  assert.deepEqual(breakPositions(10, 2.9), [4, 8], "a fractional count is rounded down");
});

test("the same seed always produces the same layout", () => {
  // Server render and client hydration must agree or React tears the page down.
  const once = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], seed: 99, columns: 4 });
  const twice = planBreaks({ products: products(40), offers: [offer(1)], guides: [guide(1)], seed: 99, columns: 4 });
  assert.deepEqual(JSON.stringify(once), JSON.stringify(twice));
});

test("different seeds change what is shown but never where", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30; seed += 1) {
    const plan = planBreaks({ products: products(60), offers: [offer(1), offer(2)], guides: [guide(1), guide(2)], promotions: [promotion(1)], seed, columns: 5 });
    assert.deepEqual(plan.map((entry) => entry.position), [10, 20, 30, 40, 50], `seed ${seed}`);
    seen.add(plan.map((entry) => entry.item.kind).join(","));
  }
  assert.ok(seen.size > 1, "the order of card types should still vary between visits");
});

test("searching or filtering does not thin the breaks out", () => {
  // planBreaks no longer has a 'focused' mode: a long result list is broken up like any other.
  const plan = planBreaks({ products: products(60), offers: [offer(1)], guides: [guide(1)], seed: 4, columns: 4 });
  assert.equal(plan.length, 7);
});

test("no offer, blog, or promotional content means no interruption", () => {
  const plan = planBreaks({ products: products(40), offers: [], guides: [], seed: 3, columns: 4 });
  assert.deepEqual(plan, []);
});

test("every available slot gets a card, for every content mix, seed and screen", () => {
  const scenarios = [
    { label: "offers only", offers: [offer(1), offer(2)], guides: [] as BreakGuide[], promotions: [] as BreakPromotion[] },
    { label: "one offer", offers: [offer(1)], guides: [] as BreakGuide[], promotions: [] as BreakPromotion[] },
    { label: "blogs only", offers: [] as BreakOffer[], guides: [guide(1), guide(2)], promotions: [] as BreakPromotion[] },
    { label: "offers and blogs", offers: [offer(1), offer(2)], guides: [guide(1), guide(2)], promotions: [] as BreakPromotion[] },
    { label: "promotions only", offers: [] as BreakOffer[], guides: [] as BreakGuide[], promotions: [promotion(1), promotion(2)] },
    { label: "all types", offers: [offer(1)], guides: [guide(1)], promotions: [promotion(1)] },
  ];
  for (const scenario of scenarios) {
    for (const { label, columns } of SCREENS) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const count = 50;
        const plan = planBreaks({ products: products(count), offers: scenario.offers, guides: scenario.guides, promotions: scenario.promotions, seed, columns });
        const slots = breakPositions(count, columns);
        assert.deepEqual(plan.map((entry) => entry.position), slots, `${scenario.label}, ${label}, seed ${seed}: a slot was left empty`);
        const expected = new Set([scenario.offers.length ? "offer" : "", scenario.guides.length ? "guide" : "", scenario.promotions.length ? "promotion" : ""].filter(Boolean));
        assert.ok(plan.every((entry) => expected.has(entry.item.kind)), `${scenario.label}, seed ${seed} emitted a kind without content`);
        // Neighbouring cards differ whenever there is more than one kind to choose from.
        if (expected.size > 1) plan.forEach((entry, index) => index > 0 && assert.notEqual(entry.item.kind, plan[index - 1].item.kind, `${scenario.label}, seed ${seed}`));
      }
    }
  }
});

test("every promotional interruption carries all adverts and rotates its lead", () => {
  const adverts = [promotion(1), promotion(2), promotion(3)];
  const plan = planBreaks({ products: products(80), offers: [], guides: [], promotions: adverts, seed: 23, columns: 4 });
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
  const plan = planBreaks({ products: products(60), offers: [offer(1, later), offer(2, soon)], guides: [], seed: 5, columns: 4 });
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
    columns: 4,
  });
  const firstGuide = plan.find((entry) => entry.item.kind === "guide");
  assert.equal(firstGuide && firstGuide.item.kind === "guide" && firstGuide.item.guide.id, 2, "the relevant guide should lead");
});

test("every blog interruption carries the full collection and rotates its lead", () => {
  const catalogueGuides = [guide(1), guide(2), guide(3), guide(4)];
  const plan = planBreaks({ products: products(60), offers: [], guides: catalogueGuides, seed: 17, columns: 4 });
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

test("with a featured shelf above, the first card follows it and the rhythm carries on", () => {
  for (const { label, columns } of SCREENS) {
    const perBreak = columns * 2;
    const positions = breakPositions(60, columns, true);
    assert.equal(positions[0], 0, `${label}: the first card sits right after the featured shelf`);
    positions.forEach((position, index) => index > 0 && assert.equal(position - (index === 1 ? 0 : positions[index - 1]), perBreak, `${label}: gap before card ${index + 1}`));
    assert.deepEqual(breakPositions(0, columns, true), [], "no products, no card");
    assert.deepEqual(breakPositions(1, columns, true), [0], "a single product still follows the card");
  }
});

test("every slot gets a card when a featured shelf leads the page", () => {
  for (const { label, columns } of SCREENS) {
    for (let seed = 1; seed <= 40; seed += 1) {
      const plan = planBreaks({ products: products(50), offers: [offer(1)], guides: [guide(1)], promotions: [promotion(1)], seed, columns, leadingBreak: true });
      assert.deepEqual(plan.map((entry) => entry.position), breakPositions(50, columns, true), `${label}, seed ${seed}`);
    }
  }
});
