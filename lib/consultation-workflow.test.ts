import assert from "node:assert/strict";
import test from "node:test";
import {
  canApplyConsultationAction,
  consultationAcceptsMessages,
  consultationActionRequiresNote,
  consultationActionResult,
  consultationStatusAfterCustomerReply,
  consultationStatuses,
  consultationTrackingSteps,
} from "./consultation-workflow.ts";

test("a new request must be picked up before it can be decided",()=>{
  assert.equal(canApplyConsultationAction("NEW","START_REVIEW"),true);
  assert.equal(canApplyConsultationAction("NEW","ISSUE_PRESCRIPTION"),false);
  assert.equal(canApplyConsultationAction("NEW","RECOMMEND_OTC"),false);
});

test("a closed consultation is terminal",()=>{
  assert.equal(consultationStatuses.includes("CLOSED"),true);
  for(const action of ["START_REVIEW","REQUEST_INFORMATION","ISSUE_PRESCRIPTION","RECOMMEND_OTC","REFER","CLOSE"] as const)
    assert.equal(canApplyConsultationAction("CLOSED",action),false,`${action} must not reopen a closed consultation`);
  assert.equal(consultationAcceptsMessages("CLOSED"),false);
  assert.equal(consultationAcceptsMessages("CONSULTATION_IN_PROGRESS"),true);
});

test("every deciding action records an outcome and closes the thread",()=>{
  assert.deepEqual(consultationActionResult("ISSUE_PRESCRIPTION"),{status:"CLOSED",outcome:"PRESCRIPTION_ISSUED"});
  assert.deepEqual(consultationActionResult("RECOMMEND_OTC"),{status:"CLOSED",outcome:"OTC_RECOMMENDED"});
  assert.deepEqual(consultationActionResult("REFER"),{status:"CLOSED",outcome:"REFERRAL_REQUIRED"});
  assert.deepEqual(consultationActionResult("CLOSE"),{status:"CLOSED",outcome:"NO_ACTION_REQUIRED"});
});

test("in-progress actions move the thread without deciding it",()=>{
  assert.deepEqual(consultationActionResult("START_REVIEW"),{status:"UNDER_REVIEW",outcome:null});
  assert.deepEqual(consultationActionResult("REQUEST_INFORMATION"),{status:"MORE_INFORMATION_REQUIRED",outcome:null});
  assert.deepEqual(consultationActionResult("BEGIN_CONSULTATION"),{status:"CONSULTATION_IN_PROGRESS",outcome:null});
});

test("a patient is told why a consultation ended without a prescription",()=>{
  assert.equal(consultationActionRequiresNote("RECOMMEND_OTC"),true);
  assert.equal(consultationActionRequiresNote("REFER"),true);
  assert.equal(consultationActionRequiresNote("REQUEST_INFORMATION"),true);
  assert.equal(consultationActionRequiresNote("START_REVIEW"),false);
});

test("a stalled request surfaces as needing the patient",()=>{
  const steps=consultationTrackingSteps({status:"MORE_INFORMATION_REQUIRED",outcome:"PENDING",hasPrescription:false});
  assert.equal(steps.some((step)=>step.key==="information"&&step.state==="attention"),true);
});

test("the timeline hands off to the prescription tracker once issued",()=>{
  const steps=consultationTrackingSteps({status:"CLOSED",outcome:"PRESCRIPTION_ISSUED",hasPrescription:true});
  assert.equal(steps.at(-1)?.key,"issued");
  // Payment and delivery belong to the prescription tracker, not here.
  assert.equal(steps.some((step)=>["payment","preparing","dispatch"].includes(step.key)),false);
});

test("answering a request for information returns the thread to the queue",()=>{
  assert.equal(consultationStatusAfterCustomerReply("MORE_INFORMATION_REQUIRED"),"UNDER_REVIEW");
  // A patient message must never advance any other stage on its own.
  assert.equal(consultationStatusAfterCustomerReply("NEW"),"NEW");
  assert.equal(consultationStatusAfterCustomerReply("UNDER_REVIEW"),"UNDER_REVIEW");
  assert.equal(consultationStatusAfterCustomerReply("CONSULTATION_IN_PROGRESS"),"CONSULTATION_IN_PROGRESS");
  assert.equal(consultationStatusAfterCustomerReply("CLOSED"),"CLOSED");
});
