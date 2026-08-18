"use client";

import { PhoneCall, Plus, Stethoscope, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  canApplyConsultationAction,
  consultationOutcomeLabels,
  consultationStatusLabels,
  consultationStatuses,
  type ConsultationAction,
  type ConsultationOutcome,
  type ConsultationStatus,
} from "@/lib/consultation-workflow";
import type { ConsultationMessage } from "@/app/account/consultations/types";

export type ConsultationQueueRecord = {
  id: number;
  reference: string;
  customerId: number | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: string;
  outcome: string;
  concern: string;
  callbackRequested: boolean;
  callbackPhone: string | null;
  prescriptionId: number | null;
  prescriberName: string | null;
  professionalNotes: string | null;
  reviewVersion: number;
  lastMessageAt: string;
  createdAt: string;
  unread: number;
};

export type ConsultationProduct = {
  id: number;
  name: string;
  packSize: string | null;
  prescriptionRequired: boolean;
};

type IssueLine = { productId: number; quantity: number; directions: string };

const actionLabels: Record<ConsultationAction, string> = {
  START_REVIEW: "Start review",
  BEGIN_CONSULTATION: "Begin consultation",
  REQUEST_INFORMATION: "Request more information",
  ISSUE_PRESCRIPTION: "Issue prescription",
  RECOMMEND_OTC: "Recommend OTC medicine",
  REFER: "Refer to a clinic",
  CLOSE: "Close without medicine",
};

const orderedActions: ConsultationAction[] = [
  "START_REVIEW", "BEGIN_CONSULTATION", "REQUEST_INFORMATION", "ISSUE_PRESCRIPTION", "RECOMMEND_OTC", "REFER", "CLOSE",
];

export function ConsultationManager({
  initialItems,
  products,
  canProcess = true,
}: {
  initialItems: ConsultationQueueRecord[];
  products: ConsultationProduct[];
  canProcess?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const [active, setActive] = useState<ConsultationQueueRecord | null>(null);
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriberRegistration, setPrescriberRegistration] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "OPEN" ? item.status !== "CLOSED" : item.status === statusFilter);
      const matchesTerm =
        !term ||
        [item.reference, item.customerName, item.customerEmail, item.customerPhone, item.concern]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStatus && matchesTerm;
    });
  }, [items, query, statusFilter]);

  async function open(record: ConsultationQueueRecord) {
    setActive(record);
    setMessages([]);
    setNote("");
    setReply("");
    setLines([]);
    setFeedback(null);
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/consultations/${record.id}/thread`);
      const data = await response.json().catch(() => ({}));
      if (response.ok) setMessages(data.messages || []);
      else setFeedback({ text: data.error || "The conversation could not be loaded.", ok: false });
    } catch {
      setFeedback({ text: "The conversation could not be loaded.", ok: false });
    } finally {
      setLoadingThread(false);
    }
  }

  async function sendReply() {
    if (!active || busy || !reply.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/consultations/${active.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setFeedback({ text: data.error || "The reply could not be sent.", ok: false });
      setMessages((current) => [
        ...current,
        {
          id: Number(data.id),
          senderRole: "PROFESSIONAL",
          message: reply.trim(),
          attachmentName: null,
          attachmentMime: null,
          hasAttachment: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      setReply("");
      setFeedback({ text: "Reply sent to the patient.", ok: true });
    } catch {
      setFeedback({ text: "The reply could not reach the server.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function apply(action: ConsultationAction) {
    if (!active || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/consultations/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewVersion: active.reviewVersion,
          note: note.trim(),
          prescriberName: prescriberName.trim(),
          prescriberRegistration: prescriberRegistration.trim(),
          items: action === "ISSUE_PRESCRIPTION" ? lines : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setFeedback({ text: data.error || "The action could not be applied.", ok: false });

      const updated: ConsultationQueueRecord = {
        ...active,
        status: data.status || active.status,
        outcome: data.outcome || active.outcome,
        prescriptionId: data.prescriptionId ?? active.prescriptionId,
        professionalNotes: note.trim() || active.professionalNotes,
        reviewVersion: Number(data.reviewVersion ?? active.reviewVersion + 1),
        unread: 0,
      };
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setActive(updated);
      setNote("");
      setLines([]);
      setFeedback({
        text:
          action === "ISSUE_PRESCRIPTION"
            ? `Prescription issued and sent to the pharmacist queue (request #${data.prescriptionId}).`
            : `${actionLabels[action]} applied.`,
        ok: true,
      });
    } catch {
      setFeedback({ text: "The action could not reach the server.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  const status = (active?.status || "NEW") as ConsultationStatus;
  const available = orderedActions.filter((action) => canApplyConsultationAction(status, action));
  const issuing = available.includes("ISSUE_PRESCRIPTION");

  return (
    <>
      <div className="rx-queue-tools">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reference, patient or symptoms"
          aria-label="Search consultations"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by stage">
          <option value="OPEN">Open consultations</option>
          <option value="ALL">All stages</option>
          {consultationStatuses.map((value) => (
            <option key={value} value={value}>
              {consultationStatusLabels[value]}
            </option>
          ))}
        </select>
      </div>

      <section className="rx-queue" aria-label="Consultation queue">
        {shown.map((item) => (
          <article key={item.id} className="rx-queue-row">
            <div>
              <small>Patient</small>
              <strong>{item.customerName || "Customer"}</strong>
              {item.callbackRequested ? (
                <span className="rx-queue-callback">
                  <PhoneCall /> Callback: {item.callbackPhone || item.customerPhone || "no number"}
                </span>
              ) : null}
            </div>
            <div>
              <small>{item.reference}</small>
              <p>{item.concern}</p>
            </div>
            <div>
              <small>Stage</small>
              <span className={`rx-status ${item.status.toLowerCase().replaceAll("_", "-")}`}>
                {consultationStatusLabels[item.status as ConsultationStatus] || item.status}
              </span>
              {item.unread ? <span className="rx-queue-unread">{item.unread} new</span> : null}
            </div>
            <button type="button" onClick={() => open(item)}>
              Open
            </button>
          </article>
        ))}
        {!shown.length ? (
          <div className="rx-consult-empty">
            <Stethoscope />
            <strong>{items.length ? "No matching consultations" : "No consultation requests yet"}</strong>
            <p>{items.length ? "Try another search or stage." : "New requests from the storefront will appear here."}</p>
          </div>
        ) : null}
      </section>

      {active ? (
        <div className="rx-panel" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setActive(null); }}>
          <section role="dialog" aria-modal="true" aria-label={`Consultation ${active.reference}`}>
            <header>
              <div>
                <span className={`rx-status ${active.status.toLowerCase().replaceAll("_", "-")}`}>
                  {consultationStatusLabels[active.status as ConsultationStatus] || active.status}
                </span>
                <h2>{active.reference}</h2>
                <p>
                  {active.customerName || "Customer"}
                  {active.customerPhone ? ` · ${active.customerPhone}` : ""}
                  {active.customerEmail ? ` · ${active.customerEmail}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setActive(null)} aria-label="Close consultation">
                <X />
              </button>
            </header>

            <div className="rx-thread-concern">
              <small>Reported concern</small>
              <p>{active.concern}</p>
            </div>

            {active.callbackRequested ? (
              <div className="rx-thread-outcome">
                <PhoneCall />
                <div>
                  <strong>Callback requested</strong>
                  <p>Call {active.callbackPhone || active.customerPhone || "the patient"} before deciding.</p>
                </div>
              </div>
            ) : null}

            <div className="rx-panel-block">
              <h3>Conversation</h3>
              <div className="rx-messages">
                {loadingThread ? (
                  <p className="rx-messages-empty">Loading conversation…</p>
                ) : messages.length ? (
                  messages.map((message) => (
                    <article key={message.id} className={message.senderRole === "PROFESSIONAL" ? "is-mine" : "is-professional"}>
                      <header>
                        <span>{message.senderRole === "PROFESSIONAL" ? "You" : "Patient"}</span>
                        <time>{new Date(message.createdAt).toLocaleString("en-KE")}</time>
                      </header>
                      <p>{message.message}</p>
                      {message.hasAttachment ? (
                        <a className="rx-attachment" href={`/api/consultations/attachments/${message.id}`} target="_blank" rel="noreferrer">
                          {message.attachmentName || "Attachment"}
                        </a>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="rx-messages-empty">No messages yet.</p>
                )}
              </div>
              {canProcess && active.status !== "CLOSED" ? (
                <>
                  <label style={{ marginTop: 10 }}>
                    <span>Reply to the patient</span>
                    <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000} />
                  </label>
                  <div className="rx-panel-actions">
                    <button type="button" onClick={sendReply} disabled={busy || !reply.trim()}>
                      Send reply
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            {canProcess && available.length ? (
              <div className="rx-panel-block">
                <h3>Decision</h3>
                <label>
                  <span>Note for the patient (required to request information, recommend, refer or close)</span>
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} />
                </label>

                {issuing ? (
                  <>
                    <div className="rx-panel-grid">
                      <label>
                        <span>Prescriber name</span>
                        <input value={prescriberName} onChange={(event) => setPrescriberName(event.target.value)} maxLength={200} />
                      </label>
                      <label>
                        <span>Registration number</span>
                        <input value={prescriberRegistration} onChange={(event) => setPrescriberRegistration(event.target.value)} maxLength={60} />
                      </label>
                    </div>

                    {lines.map((line, index) => (
                      <div key={index} className="rx-panel-line">
                        <div className="rx-panel-line-head">
                          <strong>Medicine {index + 1}</strong>
                          <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                            Remove
                          </button>
                        </div>
                        <label>
                          <span>Product</span>
                          <select
                            value={line.productId || ""}
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((item, i) => (i === index ? { ...item, productId: Number(event.target.value) } : item)),
                              )
                            }
                          >
                            <option value="">Select a medicine</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                                {product.packSize ? ` · ${product.packSize}` : ""}
                                {product.prescriptionRequired ? " · Rx" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="rx-panel-grid">
                          <label>
                            <span>Quantity</span>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={line.quantity}
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((item, i) => (i === index ? { ...item, quantity: Number(event.target.value) } : item)),
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>Directions</span>
                            <input
                              value={line.directions}
                              maxLength={300}
                              placeholder="One tablet twice daily after food"
                              onChange={(event) =>
                                setLines((current) =>
                                  current.map((item, i) => (i === index ? { ...item, directions: event.target.value } : item)),
                                )
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <div className="rx-panel-actions">
                      <button type="button" onClick={() => setLines((current) => [...current, { productId: 0, quantity: 1, directions: "" }])}>
                        <Plus /> Add medicine
                      </button>
                    </div>
                    <p style={{ margin: "8px 0 0", color: "#6d6774", fontSize: 10.5, lineHeight: 1.45 }}>
                      Issuing creates a prescription document and sends it to the pharmacist queue, where availability
                      and prices are confirmed before the patient pays.
                    </p>
                  </>
                ) : null}

                <div className="rx-panel-actions">
                  {available.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={action === "ISSUE_PRESCRIPTION" ? "primary" : undefined}
                      disabled={busy || (action === "ISSUE_PRESCRIPTION" && !lines.length)}
                      onClick={() => apply(action)}
                    >
                      {actionLabels[action]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {active.status === "CLOSED" ? (
              <div className="rx-panel-block">
                <h3>Outcome</h3>
                <p style={{ margin: 0, fontSize: 11.5 }}>
                  {consultationOutcomeLabels[active.outcome as ConsultationOutcome] || active.outcome}
                  {active.prescriberName ? ` · issued by ${active.prescriberName}` : ""}
                </p>
                {active.prescriptionId ? (
                  <p style={{ margin: "6px 0 0", fontSize: 11.5 }}>
                    <a href={`/api/prescriptions/${active.prescriptionId}/download`} target="_blank" rel="noreferrer">
                      Open the issued prescription document
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}

            {feedback ? (
              <div className={feedback.ok ? "rx-panel-message is-ok" : "rx-panel-message"} role="status">
                {feedback.text}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
