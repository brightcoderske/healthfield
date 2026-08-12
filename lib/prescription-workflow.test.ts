import assert from "node:assert/strict";
import test from "node:test";
import { canApplyPrescriptionAction, prescriptionTrackingSteps } from "./prescription-workflow.ts";

test("prescription review transitions are closed and explicit", () => {
  assert.equal(canApplyPrescriptionAction("RECEIVED", "START_REVIEW"), true);
  assert.equal(canApplyPrescriptionAction("RECEIVED", "APPROVE"), false);
  assert.equal(canApplyPrescriptionAction("UNDER_REVIEW", "APPROVE"), true);
  assert.equal(canApplyPrescriptionAction("MORE_INFORMATION_REQUIRED", "APPROVE"), false);
  assert.equal(canApplyPrescriptionAction("MORE_INFORMATION_REQUIRED", "START_REVIEW"), true);
  assert.equal(canApplyPrescriptionAction("APPROVED", "SAVE_REVIEW"), false);
  assert.equal(canApplyPrescriptionAction("DECLINED", "START_REVIEW"), false);
});

test("customer tracking follows review, payment and fulfilment", () => {
  assert.equal(prescriptionTrackingSteps({ prescriptionStatus: "UNDER_REVIEW" })[1].state, "current");
  assert.equal(prescriptionTrackingSteps({ prescriptionStatus: "MORE_INFORMATION_REQUIRED" })[2].state, "attention");
  assert.equal(prescriptionTrackingSteps({ prescriptionStatus: "APPROVED", paymentStatus: "PAID", orderStatus: "CONFIRMED" }).find((step) => step.key === "payment")?.state, "current");
  const paid = prescriptionTrackingSteps({ prescriptionStatus: "APPROVED", paymentStatus: "PAID", orderStatus: "BEING_FULFILLED" });
  assert.equal(paid.find((step) => step.key === "payment")?.state, "complete");
  assert.equal(paid.find((step) => step.key === "preparing")?.state, "current");
  const complete = prescriptionTrackingSteps({ prescriptionStatus: "APPROVED", paymentStatus: "PAID", orderStatus: "COMPLETED" });
  assert.equal(complete.every((step) => step.state === "complete"), true);
});
