export const prescriptionStatuses = ["RECEIVED", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "APPROVED", "DECLINED"] as const;
export type PrescriptionStatus = (typeof prescriptionStatuses)[number];

export const prescriptionStatusLabels: Record<PrescriptionStatus, string> = {
  RECEIVED: "Received",
  UNDER_REVIEW: "Pharmacist review",
  MORE_INFORMATION_REQUIRED: "Action required",
  APPROVED: "Approved",
  DECLINED: "Declined",
};

export const prescriptionReviewActions = ["START_REVIEW", "SAVE_REVIEW", "REQUEST_CLARIFICATION", "APPROVE", "DECLINE"] as const;
export type PrescriptionReviewAction = (typeof prescriptionReviewActions)[number];

const allowedActions: Record<PrescriptionStatus, readonly PrescriptionReviewAction[]> = {
  RECEIVED: ["START_REVIEW"],
  UNDER_REVIEW: ["SAVE_REVIEW", "REQUEST_CLARIFICATION", "APPROVE", "DECLINE"],
  MORE_INFORMATION_REQUIRED: ["START_REVIEW", "DECLINE"],
  APPROVED: [],
  DECLINED: [],
};

export function canApplyPrescriptionAction(status: PrescriptionStatus, action: PrescriptionReviewAction) {
  return allowedActions[status].includes(action);
}

export type PrescriptionTrackingStep = {
  key: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "attention";
};

export function prescriptionTrackingSteps(input: { prescriptionStatus: string; orderStatus?: string | null; paymentStatus?: string | null }) {
  const { prescriptionStatus, orderStatus, paymentStatus } = input;
  const actionRequired = prescriptionStatus === "MORE_INFORMATION_REQUIRED";
  const declined = prescriptionStatus === "DECLINED";
  const approved = prescriptionStatus === "APPROVED";
  const paid = paymentStatus === "PAID";
  const preparing = ["BEING_FULFILLED", "PARTIALLY_READY"].includes(orderStatus || "");
  const dispatched = ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP"].includes(orderStatus || "");
  const completed = orderStatus === "COMPLETED";
  const paymentStepComplete = paid && (preparing || dispatched || completed);

  const steps: PrescriptionTrackingStep[] = [
    { key: "received", label: "Request received", state: "complete" },
    { key: "review", label: "Pharmacist review", state: approved || actionRequired || declined ? "complete" : "current" },
  ];
  if (actionRequired) steps.push({ key: "action", label: "Action required", state: "attention" });
  if (declined) steps.push({ key: "declined", label: "Not approved", state: "attention" });
  else {
    steps.push({ key: "approved", label: "Approved & priced", state: approved ? "complete" : "upcoming" });
    steps.push({ key: "payment", label: "Payment confirmed", state: paymentStepComplete ? "complete" : paid || approved ? "current" : "upcoming" });
    steps.push({ key: "preparing", label: "Being prepared", state: completed || dispatched ? "complete" : preparing ? "current" : "upcoming" });
    steps.push({ key: "dispatch", label: "Dispatched / ready", state: completed ? "complete" : dispatched ? "current" : "upcoming" });
    steps.push({ key: "completed", label: "Completed", state: completed ? "complete" : "upcoming" });
  }
  return steps;
}
