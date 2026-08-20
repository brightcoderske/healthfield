import assert from "node:assert/strict";
import test from "node:test";
import { costFromSellingPrice, marginPercent, sellingPriceFromCost, summariseProfit } from "./profit.ts";

test("a buying price sets the selling price at 133%", () => {
  assert.equal(sellingPriceFromCost(100), 133);
  assert.equal(sellingPriceFromCost("450.50"), 599.17);
  assert.equal(sellingPriceFromCost(0), null);
  assert.equal(sellingPriceFromCost("not money"), null);
});

test("seeding a buying price from a shelf price is the same rule, reversed", () => {
  assert.equal(costFromSellingPrice(133), 100);
  assert.equal(costFromSellingPrice(599.17), 450.5);
});

test("margin is stated against the selling price, not the cost", () => {
  // A 33% markup is a 24.81% margin; reporting 33% would overstate every sale.
  assert.equal(marginPercent(100, 133), 24.81);
});

test("profit is revenue less the cost of what was sold", () => {
  const summary = summariseProfit([
    { lineTotal: "266.00", quantity: 2, unitCost: "100.00" },
    { lineTotal: "133.00", quantity: 1, unitCost: "100.00" },
  ]);
  assert.equal(summary.sales, 399);
  assert.equal(summary.cost, 300);
  assert.equal(summary.profit, 99);
  assert.equal(summary.estimatedLines, 0);
});

test("a line without its own cost falls back to the product, and says so", () => {
  const summary = summariseProfit([{ lineTotal: "133.00", quantity: 1, productCost: "100.00" }]);
  assert.equal(summary.profit, 33);
  assert.equal(summary.estimatedLines, 1);
  assert.equal(summary.estimatedSales, 133);
});

test("the sale-time cost wins over today's cost, so old reports do not move", () => {
  const summary = summariseProfit([{ lineTotal: "133.00", quantity: 1, unitCost: "100.00", productCost: "120.00" }]);
  assert.equal(summary.cost, 100);
  assert.equal(summary.profit, 33);
});

test("a line with no cost anywhere counts as sales but never as profit", () => {
  const summary = summariseProfit([
    { lineTotal: "500.00", quantity: 1 },
    { lineTotal: "133.00", quantity: 1, unitCost: "100.00" },
  ]);
  assert.equal(summary.sales, 633);
  assert.equal(summary.cost, 100);
  // The 500 is held out of profit rather than counted as pure margin.
  assert.equal(summary.profit, 33);
  assert.equal(summary.unpricedLines, 1);
  assert.equal(summary.unpricedSales, 500);
});
