"use client";

import Image from "next/image";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [message, setMessage] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is missing or incomplete.");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      setSaving(false);
      return;
    }
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Password could not be reset.");
    else setMessage(data.message || "Password updated. You can sign in now.");
    setSaving(false);
  }

  return (
    <form onSubmit={submit}>
      <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={190} height={70} /></a>
      <h1>Choose a new password</h1>
      <p>Use at least 8 characters with upper and lower case letters and a number.</p>
      <label>New password<input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
      <label>Confirm password<input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="form-message">{message}</div>}
      <button disabled={saving || !token || Boolean(message)}>{saving ? "Saving…" : "Update password"}</button>
      <a className="auth-register" href="/login">Back to login</a>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="password-page">
      <Suspense fallback={<form><h1>Choose a new password</h1><p>Loading reset form…</p></form>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
