import assert from "node:assert/strict";
import test from "node:test";
import { applicableOrderStatuses, canTransitionOrderStatus, isStockFinalizedOrderStatus, orderTransitionChangesAllocation } from "./order-status-transitions.ts";

test("ready-for-dispatch orders can move forward to delivery or completion", () => {
  assert.equal(canTransitionOrderStatus("READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"), true);
  assert.equal(canTransitionOrderStatus("READY_FOR_DISPATCH", "COMPLETED"), true);
  assert.equal(canTransitionOrderStatus("READY_FOR_DISPATCH", "CONFIRMED"), false);
  assert.equal(canTransitionOrderStatus("READY_FOR_DISPATCH", "CANCELLED"), false);
});

test("ready-for-pickup and out-for-delivery orders can complete", () => {
  assert.equal(canTransitionOrderStatus("READY_FOR_PICKUP", "COMPLETED"), true);
  assert.equal(canTransitionOrderStatus("OUT_FOR_DELIVERY", "COMPLETED"), true);
});

test("completed and cancelled orders remain terminal", () => {
  assert.equal(canTransitionOrderStatus("COMPLETED", "OUT_FOR_DELIVERY"), false);
  assert.equal(canTransitionOrderStatus("CANCELLED", "NEW"), false);
});

test("all dispatched and ready states have already finalized stock", () => {
  assert.equal(isStockFinalizedOrderStatus("READY_FOR_DISPATCH"), true);
  assert.equal(isStockFinalizedOrderStatus("OUT_FOR_DELIVERY"), true);
  assert.equal(isStockFinalizedOrderStatus("READY_FOR_PICKUP"), true);
  assert.equal(isStockFinalizedOrderStatus("COMPLETED"), true);
  assert.equal(isStockFinalizedOrderStatus("BEING_FULFILLED"), false);
});

test("post-packaging status moves do not deduct or release stock again", () => {
  assert.equal(orderTransitionChangesAllocation("BEING_FULFILLED", "READY_FOR_DISPATCH", false), true);
  assert.equal(orderTransitionChangesAllocation("READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", false), false);
  assert.equal(orderTransitionChangesAllocation("READY_FOR_DISPATCH", "COMPLETED", false), false);
  assert.equal(orderTransitionChangesAllocation("OUT_FOR_DELIVERY", "COMPLETED", false), false);
});

test("delivery and pickup workflows expose only applicable statuses", () => {
  assert.equal(applicableOrderStatuses("DELIVERY").includes("READY_FOR_PICKUP"), false);
  assert.equal(applicableOrderStatuses("DELIVERY").includes("OUT_FOR_DELIVERY"), true);
  assert.equal(applicableOrderStatuses("PICKUP").includes("READY_FOR_DISPATCH"), false);
  assert.equal(applicableOrderStatuses("PICKUP").includes("OUT_FOR_DELIVERY"), false);
  assert.equal(applicableOrderStatuses("PICKUP").includes("READY_FOR_PICKUP"), true);
  assert.equal(canTransitionOrderStatus("BEING_FULFILLED", "OUT_FOR_DELIVERY", "PICKUP"), false);
});
