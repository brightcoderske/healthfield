import assert from "node:assert/strict";
import test from "node:test";
import { cashChange, expectedSessionCash, saleTotal, sessionCashDifference, splitPaymentBalances } from "./pos.ts";

test("a sale discount cannot make a negative total", () => {
  assert.equal(saleTotal(1_000, 125), 875);
  assert.equal(saleTotal(1_000, 2_000), 0);
});

test("cash change is only available after enough cash is tendered", () => {
  assert.equal(cashChange(875, 1_000), 125);
  assert.equal(cashChange(875, 800), null);
});

test("split payments must equal the total to the cent", () => {
  assert.equal(splitPaymentBalances(1_850, [{ amount: 850 }, { amount: 1_000 }]), true);
  assert.equal(splitPaymentBalances(1_850, [{ amount: 850 }, { amount: 999 }]), false);
});

test("closing cash uses counted opening cash, cash sales and cash expenses", () => {
  const expected = expectedSessionCash({ openingCash: 4_000, cashSales: 12_500, cashExpenses: 750 });
  assert.equal(expected, 15_750);
  assert.equal(sessionCashDifference(15_700, expected), -50);
  assert.equal(sessionCashDifference(15_800, expected), 50);
});
