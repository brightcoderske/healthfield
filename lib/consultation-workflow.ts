export const consultationStatuses = ["NEW", "UNDER_REVIEW", "MORE_INFORMATION_REQUIRED", "CONSULTATION_IN_PROGRESS", "CLOSED"] as const;
export type ConsultationStatus = (typeof consultationStatuses)[number];

export const consultationOutcomes = ["PENDING", "PRESCRIPTION_ISSUED", "OTC_RECOMMENDED", "REFERRAL_REQUIRED", "NO_ACTION_REQUIRED"] as const;
export type ConsultationOutcome = (typeof consultationOutcomes)[number];

export const consultationStatusLabels: Record<ConsultationStatus, string> = {
  NEW: "New request",
  UNDER_REVIEW: "Under review",
  MORE_INFORMATION_REQUIRED: "More information required",
  CONSULTATION_IN_PROGRESS: "Consultation in progress",
  CLOSED: "Completed",
};

export const consultationOutcomeLabels: Record<ConsultationOutcome, string> = {
  PENDING: "Awaiting decision",
  PRESCRIPTION_ISSUED: "Prescription issued",
  OTC_RECOMMENDED: "Over-the-counter medicine recommended",
  REFERRAL_REQUIRED: "Referral required",
  NO_ACTION_REQUIRED: "No medicine required",
};

export const consultationActions = ["START_REVIEW", "REQUEST_INFORMATION", "BEGIN_CONSULTATION", "ISSUE_PRESCRIPTION", "RECOMMEND_OTC", "REFER", "CLOSE"] as const;
export type ConsultationAction = (typeof consultationActions)[number];

const allowedActions: Record<ConsultationStatus, readonly ConsultationAction[]> = {
  NEW: ["START_REVIEW", "CLOSE"],
  UNDER_REVIEW: ["REQUEST_INFORMATION", "BEGIN_CONSULTATION", "ISSUE_PRESCRIPTION", "RECOMMEND_OTC", "REFER", "CLOSE"],
  MORE_INFORMATION_REQUIRED: ["START_REVIEW", "BEGIN_CONSULTATION", "CLOSE"],
  CONSULTATION_IN_PROGRESS: ["REQUEST_INFORMATION", "ISSUE_PRESCRIPTION", "RECOMMEND_OTC", "REFER", "CLOSE"],
  CLOSED: [],
};

// Every action that ends the consultation records why it ended, so the outcome is
// never inferred from the status alone.
const terminalOutcomes: Partial<Record<ConsultationAction, ConsultationOutcome>> = {
  ISSUE_PRESCRIPTION: "PRESCRIPTION_ISSUED",
  RECOMMEND_OTC: "OTC_RECOMMENDED",
  REFER: "REFERRAL_REQUIRED",
  CLOSE: "NO_ACTION_REQUIRED",
};

export function canApplyConsultationAction(status: ConsultationStatus, action: ConsultationAction) {
  return allowedActions[status].includes(action);
}

export function consultationActionResult(action: ConsultationAction): { status: ConsultationStatus; outcome: ConsultationOutcome | null } {
  const outcome = terminalOutcomes[action];
  if (outcome) return { status: "CLOSED", outcome };
  if (action === "START_REVIEW") return { status: "UNDER_REVIEW", outcome: null };
  if (action === "REQUEST_INFORMATION") return { status: "MORE_INFORMATION_REQUIRED", outcome: null };
  return { status: "CONSULTATION_IN_PROGRESS", outcome: null };
}

// A closed consultation keeps its history readable but stops accepting replies, so
// a resolved thread cannot be reopened by either side posting into it.
export function consultationAcceptsMessages(status: ConsultationStatus) {
  return status !== "CLOSED";
}

// Actions that end the consultation must explain themselves to the patient.
export function consultationActionRequiresNote(action: ConsultationAction) {
  return ["REQUEST_INFORMATION", "RECOMMEND_OTC", "REFER", "CLOSE"].includes(action);
}

// A patient answering a request for more information puts the consultation back in
// the professional's queue. This is the one transition the patient can cause, so it
// lives here with the rest of the machine rather than inside the message handler.
export function consultationStatusAfterCustomerReply(status: ConsultationStatus): ConsultationStatus {
  return status === "MORE_INFORMATION_REQUIRED" ? "UNDER_REVIEW" : status;
}

export type ConsultationTrackingStep = {
  key: string;
  label: string;
  state: "complete" | "current" | "upcoming" | "attention";
};

// The consultation timeline deliberately stops at "prescription issued". Everything
// after that point already belongs to the prescription tracker, which stays the one
// place that reports review, payment and delivery progress.
export function consultationTrackingSteps(input: { status: string; outcome: string; hasPrescription: boolean }): ConsultationTrackingStep[] {
  const { status, outcome, hasPrescription } = input;
  const closed = status === "CLOSED";
  const needsCustomer = status === "MORE_INFORMATION_REQUIRED";
  const consulting = status === "CONSULTATION_IN_PROGRESS";
  const reviewed = closed || consulting || needsCustomer || status === "UNDER_REVIEW";

  const steps: ConsultationTrackingStep[] = [
    { key: "submitted", label: "Request submitted", state: "complete" },
    { key: "review", label: "Healthcare professional review", state: closed || consulting ? "complete" : reviewed ? "current" : "upcoming" },
  ];
  if (needsCustomer) steps.push({ key: "information", label: "More information needed", state: "attention" });
  steps.push({ key: "consultation", label: "Consultation", state: closed ? "complete" : consulting ? "current" : "upcoming" });

  if (closed && outcome === "PRESCRIPTION_ISSUED" && hasPrescription)
    steps.push({ key: "issued", label: "Prescription issued", state: "complete" });
  else if (closed && outcome === "OTC_RECOMMENDED")
    steps.push({ key: "otc", label: "Over-the-counter advice given", state: "complete" });
  else if (closed && outcome === "REFERRAL_REQUIRED")
    steps.push({ key: "referral", label: "Referred to a clinic", state: "attention" });
  else if (closed)
    steps.push({ key: "closed", label: "Consultation closed", state: "complete" });
  else steps.push({ key: "outcome", label: "Outcome", state: "upcoming" });

  return steps;
}
