import assert from "node:assert/strict";
import test from "node:test";
import { activeOrderStatuses, isPastOrder, pastOrderStatuses } from "../app/admin/order-buckets.ts";

test("active orders contain only records that still need fulfilment action", () => {
  const active: readonly string[] = activeOrderStatuses;
  assert.equal(active.includes("CANCELLED"), false);
  assert.equal(active.includes("OUT_FOR_DELIVERY"), false);
  assert.equal(active.includes("COMPLETED"), false);
});

test("cancelled, dispatched and completed orders live in Past Orders", () => {
  assert.deepEqual([...pastOrderStatuses], ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"]);
  assert.equal(isPastOrder("CANCELLED"), true);
  assert.equal(isPastOrder("OUT_FOR_DELIVERY"), true);
  assert.equal(isPastOrder("COMPLETED"), true);
});
