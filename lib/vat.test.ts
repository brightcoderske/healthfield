import assert from "node:assert/strict";
import test from "node:test";
import { parseVatRate, vatIncludedIn, vatLabel } from "./vat.ts";

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
