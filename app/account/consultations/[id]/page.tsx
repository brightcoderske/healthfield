import { AlertTriangle, Check, Circle, Paperclip, PhoneCall, Stethoscope } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import {
  consultationOutcomeLabels,
  consultationStatusLabels,
  consultationTrackingSteps,
  type ConsultationOutcome,
  type ConsultationStatus,
} from "@/lib/consultation-workflow";
import { ConsultationReply } from "./consultation-reply";
import type { ConsultationThread } from "../types";

export const dynamic = "force-dynamic";

export default async function CustomerConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["CUSTOMER"]);
  const id = Number((await params).id);
  let data: ConsultationThread;
  try {
    data = await backendJson<ConsultationThread>(`/v1/views/consultation/${id}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
  const { consultation, messages } = data;
  const status = consultation.status as ConsultationStatus;
  const outcome = consultation.outcome as ConsultationOutcome;
  const steps = consultationTrackingSteps({
    status: consultation.status,
    outcome: consultation.outcome,
    hasPrescription: Boolean(consultation.prescriptionId),
  });
  const closed = status === "CLOSED";

  return (
    <main className="rx-thread-page">
      <div className="rx-thread-head">
        <Link href="/account/consultations">← My consultations</Link>
        <Link href="/#products">Continue shopping</Link>
      </div>

      <section className="rx-thread-hero">
        <span className={`rx-status ${consultation.status.toLowerCase().replaceAll("_", "-")}`}>
          {consultationStatusLabels[status] || consultation.status.replaceAll("_", " ")}
        </span>
        <h1>Consultation {consultation.reference}</h1>
        <p>Started {new Date(consultation.createdAt).toLocaleString("en-KE")}</p>

        <div className="rx-thread-concern">
          <small>What you told us</small>
          <p>{consultation.concern}</p>
        </div>

        {consultation.callbackRequested && !closed ? (
          <div className="rx-thread-outcome">
            <PhoneCall />
            <div>
              <strong>Callback requested</strong>
              <p>A healthcare professional will call you on {consultation.callbackPhone || "your registered number"}.</p>
            </div>
          </div>
        ) : null}

        {closed ? (
          <div className="rx-thread-outcome">
            <Check />
            <div>
              <strong>{consultationOutcomeLabels[outcome] || "Consultation completed"}</strong>
              {consultation.professionalNotes ? <p>{consultation.professionalNotes}</p> : null}
              {consultation.prescriptionId ? (
                <Link href={`/account/prescriptions/${consultation.prescriptionId}`}>
                  Track your prescription and pay →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="prescription-tracker">
        <header>
          <div>
            <small>Live progress</small>
            <h2>Consultation journey</h2>
          </div>
          <span>{consultationStatusLabels[status] || consultation.status}</span>
        </header>
        <ol>
          {steps.map((step) => (
            <li key={step.key} className={step.state}>
              <i>
                {step.state === "complete" ? <Check /> : step.state === "attention" ? <AlertTriangle /> : <Circle />}
              </i>
              <span>
                <strong>{step.label}</strong>
                <small>
                  {step.state === "complete"
                    ? "Completed"
                    : step.state === "current"
                      ? "Current stage"
                      : step.state === "attention"
                        ? "Your attention is needed"
                        : "Upcoming"}
                </small>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rx-messages">
        {messages.length ? (
          messages.map((message) => (
            <article key={message.id} className={message.senderRole === "CUSTOMER" ? "is-mine" : "is-professional"}>
              <header>
                <span>{message.senderRole === "CUSTOMER" ? "You" : "Healthcare professional"}</span>
                <time>{new Date(message.createdAt).toLocaleString("en-KE")}</time>
              </header>
              <p>{message.message}</p>
              {message.hasAttachment ? (
                <a
                  className="rx-attachment"
                  href={`/api/consultations/attachments/${message.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Paperclip /> {message.attachmentName || "Attachment"}
                </a>
              ) : null}
            </article>
          ))
        ) : (
          <p className="rx-messages-empty">
            No replies yet. A healthcare professional will respond here shortly.
          </p>
        )}
      </section>

      {closed ? (
        <p className="rx-reply-closed">
          This consultation is complete, so replies are closed. Need more help?{" "}
          <Link href="/prescriptions/consult">Start a new consultation</Link>.
        </p>
      ) : (
        <ConsultationReply consultationId={consultation.id} />
      )}

      <div className="rx-consult-note" style={{ marginTop: 14 }}>
        <Stethoscope />
        <span>
          Anything shared here is read only by the authorised professional handling your case. If your symptoms
          become severe or urgent, contact a clinic or emergency service directly.
        </span>
      </div>
    </main>
  );
}
