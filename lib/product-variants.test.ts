import assert from "node:assert/strict";
import test from "node:test";
import { defaultVariant, groupKey, groupVariants, productName, variantDisplayName, type VariantRow } from "./product-variants.ts";

const row = (id: number, extra: Partial<VariantRow> = {}): VariantRow => ({
  id, name: "Tote bag", price: 1000, discountPrice: null, imageUrl: null, ...extra,
});
// A row's stored name carries its label; the label-free name lives on the lead only.
const bag = [
  row(1, { name: "Tote bag — Blue", groupName: "Tote bag", variantLabel: "Blue", variantName: "Colour", variantOrder: 0 }),
  row(2, { name: "Tote bag — Red", variantOf: 1, variantLabel: "Red", variantOrder: 1, price: 1200 }),
  row(3, { name: "Tote bag — Green", variantOf: 1, variantLabel: "Green", variantOrder: 2, price: 1100 }),
];

test("a plain product is a group of one with nothing to choose", () => {
  const [group] = groupVariants([row(9, { name: "Paracetamol" })]);
  assert.equal(group.id, 9);
  assert.equal(group.hasChoice, false);
  assert.equal(group.pricesDiffer, false);
  assert.equal(group.defaultVariant.id, 9);
});

test("siblings collapse into one group led by the row they point at", () => {
  const [group] = groupVariants(bag);
  assert.equal(group.id, 1);
  assert.equal(group.name, "Tote bag");
  assert.equal(group.optionName, "Colour");
  assert.equal(group.hasChoice, true);
  assert.deepEqual(group.variants.map((variant) => variant.variantLabel), ["Blue", "Red", "Green"]);
  assert.equal(group.lowestPrice, 1000);
  assert.equal(group.highestPrice, 1200);
  assert.equal(group.pricesDiffer, true);
});

test("variants that all cost the same are not advertised as a price range", () => {
  const sized = [
    row(4, { name: "Syrup", variantLabel: "100 ml" }),
    row(5, { name: "Syrup", variantOf: 4, variantLabel: "200 ml" }),
  ];
  const [group] = groupVariants(sized);
  assert.equal(group.pricesDiffer, false);
  assert.equal(group.lowestPrice, 1000);
});

test("grouping keeps the order the rows arrived in", () => {
  // The storefront has already decided what leads the page; grouping must not reorder it.
  const groups = groupVariants([row(7, { name: "Plasters" }), ...bag, row(8, { name: "Gauze" })]);
  assert.deepEqual(groups.map((group) => group.id), [7, 1, 8]);
});

test("a group opens on the cheapest variant that can actually be bought", () => {
  const stock = [
    row(1, { price: 500, inStock: false }),
    row(2, { variantOf: 1, price: 800, inStock: true }),
    row(3, { variantOf: 1, price: 900, inStock: true }),
  ];
  assert.equal(defaultVariant(stock).id, 2);
  // Nothing in stock anywhere still has to show something, and it shows the cheapest.
  assert.equal(defaultVariant(stock.map((variant) => ({ ...variant, inStock: false }))).id, 1);
  // A shop that has told us nothing about stock simply gets the cheapest.
  assert.equal(defaultVariant(bag).id, 1);
});

test("a discount counts as the price for choosing the default and the range", () => {
  const discounted = [
    row(1, { price: 1000 }),
    row(2, { variantOf: 1, price: 2000, discountPrice: 400 }),
  ];
  assert.equal(defaultVariant(discounted).id, 2);
  assert.equal(groupVariants(discounted)[0].lowestPrice, 400);
});

test("a search that returned only a sibling still forms a usable group", () => {
  const [group] = groupVariants([row(3, { name: "Tote bag — Green", variantOf: 1, variantLabel: "Green" })]);
  assert.equal(group.id, 1);
  assert.equal(group.lead.id, 3);
  assert.equal(group.hasChoice, false);
  // No lead to read the label-free name from, so the sibling's own name stands in.
  assert.equal(group.name, "Tote bag — Green");
});

test("a group is titled without any label, while its rows keep theirs", () => {
  const [group] = groupVariants(bag);
  assert.equal(group.name, "Tote bag");
  assert.deepEqual(group.variants.map((variant) => variant.name), ["Tote bag — Blue", "Tote bag — Red", "Tote bag — Green"]);
  assert.equal(productName({ name: "Paracetamol", groupName: null }), "Paracetamol");
});

test("a variant carries its label once it leaves the group", () => {
  assert.equal(variantDisplayName("Tote bag", "Blue"), "Tote bag — Blue");
  assert.equal(variantDisplayName("Paracetamol", null), "Paracetamol");
  assert.equal(variantDisplayName("Paracetamol", "   "), "Paracetamol");
});

test("groupKey treats a lead as its own group", () => {
  assert.equal(groupKey({ id: 1, variantOf: null }), 1);
  assert.equal(groupKey({ id: 2, variantOf: 1 }), 1);
});
