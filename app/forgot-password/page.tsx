"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    setMessage("");
    const email = String(new FormData(event.currentTarget).get("email") || "");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Unable to send reset instructions.");
    else setMessage(data.message || "If this email is registered, reset instructions will be sent.");
    setSending(false);
  }

  return (
    <main className="password-page">
      <form onSubmit={submit}>
        <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={190} height={70} /></a>
        <h1>Forgot password?</h1>
        <p>Enter your account email. If it is registered, Healthfield will send password-reset instructions.</p>
        <label>Email address<input name="email" type="email" required /></label>
        {error && <div className="auth-error">{error}</div>}
        {message && <div className="form-message">{message}</div>}
        <button disabled={sending}>{sending ? "Sending…" : "Send reset instructions"}</button>
        <a className="auth-register" href="/login">Back to login</a>
      </form>
    </main>
  );
}
