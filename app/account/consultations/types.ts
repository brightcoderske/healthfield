export type ConsultationRecord = {
  id: number;
  reference: string;
  customerId: number;
  status: string;
  outcome: string;
  concern: string;
  callbackRequested: boolean;
  callbackPhone: string | null;
  prescriptionId: number | null;
  assignedTo: number | null;
  prescriberName: string | null;
  prescriberRegistration: string | null;
  professionalNotes: string | null;
  reviewVersion: number;
  lastMessageAt: string;
  createdAt: string;
};

export type ConsultationMessage = {
  id: number;
  senderRole: "CUSTOMER" | "PROFESSIONAL";
  message: string;
  attachmentName: string | null;
  attachmentMime: string | null;
  hasAttachment: boolean;
  createdAt: string;
};

export type ConsultationThread = {
  consultation: ConsultationRecord;
  messages: ConsultationMessage[];
};

export type ConsultationSummary = Pick<
  ConsultationRecord,
  "id" | "reference" | "status" | "outcome" | "concern" | "callbackRequested" | "prescriptionId" | "lastMessageAt" | "createdAt"
>;
