"use client";

import { AlertCircle, CheckCircle2, PhoneCall, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export function ConsultationRequestForm() {
  const [concern, setConcern] = useState("");
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [callbackPhone, setCallbackPhone] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<{ id: number; reference: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || created) return;
    if (concern.trim().length < 10) {
      setFailed(true);
      return setMessage("Describe your symptoms in a little more detail so the professional can help.");
    }
    if (callbackRequested && !callbackPhone.trim()) {
      setFailed(true);
      return setMessage("Add a phone number so we know where to call you.");
    }
    setSending(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concern: concern.trim(), callbackRequested, callbackPhone: callbackPhone.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFailed(true);
        return setMessage(data.error || "The request could not be sent. Please try again.");
      }
      setCreated({ id: Number(data.id), reference: String(data.reference || "") });
      setMessage("Your request has been sent. A healthcare professional will review it and reply in the conversation.");
    } catch {
      setFailed(true);
      setMessage("The request could not reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="rx-consult-page">
      <Link href="/">← Continue shopping</Link>
      <form className="rx-consult-form" onSubmit={submit}>
        <Stethoscope />
        <span className="auth-kicker">Prescription consultation</span>
        <h1>Get a prescription</h1>
        <p>
          Tell us what you are experiencing. A healthcare professional reads every request, may ask follow-up
          questions, and then decides whether a prescription, an over-the-counter medicine or a clinic visit is
          right for you.
        </p>

        <label>
          <span>What are your symptoms or health concern?</span>
          <textarea
            value={concern}
            onChange={(event) => setConcern(event.target.value)}
            maxLength={4000}
            placeholder="For example: sore throat and fever for three days, difficulty swallowing, no known allergies."
            disabled={Boolean(created)}
            required
          />
        </label>

        <div className="rx-consult-callback">
          <label>
            <input
              type="checkbox"
              checked={callbackRequested}
              onChange={(event) => setCallbackRequested(event.target.checked)}
              disabled={Boolean(created)}
            />
            <span>
              <strong>Request a callback</strong>
              <small>Prefer to talk it through? A professional will call you instead of typing.</small>
            </span>
          </label>
          {callbackRequested ? (
            <div>
              <label>
                <span>Phone number for the callback</span>
                <input
                  type="tel"
                  value={callbackPhone}
                  onChange={(event) => setCallbackPhone(event.target.value)}
                  maxLength={30}
                  placeholder="07xx xxx xxx"
                  disabled={Boolean(created)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="rx-consult-note">
          <ShieldCheck />
          <span>
            This starts a consultation, not an order. Healthfield does not issue prescriptions automatically — a
            professional reviews your case first, and you only pay for medicines after they have been confirmed.
          </span>
        </div>

        {message ? (
          <div className={failed ? "rx-consult-message is-error" : "rx-consult-message"} role="status">
            {failed ? <AlertCircle /> : <CheckCircle2 />} {message}
          </div>
        ) : null}

        {created ? (
          <div className="rx-consult-done">
            <Link href={`/account/consultations/${created.id}`}>Open consultation {created.reference}</Link>
            <Link href="/#products">Keep shopping</Link>
          </div>
        ) : (
          <button disabled={sending}>
            {callbackRequested ? <PhoneCall /> : <Stethoscope />}
            {sending ? "Sending…" : callbackRequested ? "Request consultation and callback" : "Start consultation"}
          </button>
        )}
      </form>
    </main>
  );
}
