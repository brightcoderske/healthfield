import assert from "node:assert/strict";
import test from "node:test";
import { parseVatRate, vatIncludedIn, vatLabel, vatOnNet, vatRateLabel } from "./vat.ts";

test("VAT is extracted from a tax-inclusive total, never added to it", () => {
  // 1,160 inclusive of 16% carries 160 of VAT; adding 16% would print 185.60.
  assert.equal(vatIncludedIn(1160, 16), 160);
  assert.equal(vatIncludedIn("1160.00", "16.00"), 160);
});

test("cents are rounded rather than left to float noise", () => {
  assert.equal(vatIncludedIn(999.99, 16), 137.93);
});

test("no rate, no total and nonsense all keep the line off the receipt", () => {
  assert.equal(vatIncludedIn(1160, 0), null);
  assert.equal(vatIncludedIn(1160, null), null);
  assert.equal(vatIncludedIn(0, 16), null);
  assert.equal(vatIncludedIn("not money", 16), null);
});

test("a rate is clamped and sanitised before it can reach a receipt", () => {
  assert.equal(parseVatRate("16"), 16);
  assert.equal(parseVatRate(-4), 0);
  assert.equal(parseVatRate(1600), 100);
});

test("the label carries the rate that was in force", () => {
  assert.equal(vatLabel(16), "VAT (16% incl.)");
  assert.equal(vatLabel("14.50"), "VAT (14.5% incl.)");
  assert.equal(vatLabel(0), "VAT");
});

test("VAT is added on top of a net amount", () => {
  assert.equal(vatOnNet(1000, 16), 160);
  assert.equal(vatOnNet("1000.00", "16.00"), 160);
  assert.equal(vatOnNet(999.99, 16), 160);
});

test("an additive VAT line is left off when there is nothing to charge", () => {
  assert.equal(vatOnNet(1000, 0), null);
  assert.equal(vatOnNet(0, 16), null);
  assert.equal(vatOnNet("not money", 16), null);
});

test("the exclusive label omits the inclusive wording", () => {
  assert.equal(vatRateLabel(16), "VAT (16%)");
  assert.equal(vatRateLabel(0), "VAT");
});
