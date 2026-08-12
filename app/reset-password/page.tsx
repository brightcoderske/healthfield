"use client";

import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [message, setMessage] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is missing or incomplete.");
  const [saving, setSaving] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordIsValid = newPassword.length >= 8 && /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const passwordsMatch = Boolean(confirmPassword) && newPassword === confirmPassword;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !passwordIsValid || !passwordsMatch) return;
    setSaving(true);
    setError("");
    setMessage("");
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
      <Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={190} height={70} /></Link>
      <h1>Choose a new password</h1>
      <p>Use at least 8 characters with upper and lower case letters and a number.</p>
      <label>New password<span className="password-field"><input name="newPassword" type={showNewPassword ? "text" : "password"} minLength={8} required autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-describedby="password-requirements" /><button type="button" onClick={() => setShowNewPassword((value) => !value)} aria-label={showNewPassword ? "Hide new password" : "Show new password"} aria-pressed={showNewPassword}>{showNewPassword ? <EyeOff /> : <Eye />}</button></span></label>
      <small id="password-requirements" className={passwordIsValid ? "password-valid" : ""}>{passwordIsValid ? "Password meets the requirements." : "Use 8 or more characters, including uppercase, lowercase and a number."}</small>
      <label>Confirm password<span className="password-field"><input name="confirmPassword" type={showConfirmPassword ? "text" : "password"} minLength={8} required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={Boolean(confirmPassword) && !passwordsMatch} /><button type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? "Hide confirmed password" : "Show confirmed password"} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff /> : <Eye />}</button></span></label>
      {confirmPassword && <small className={passwordsMatch ? "password-valid" : "password-invalid"}>{passwordsMatch ? "Passwords match." : "Passwords do not match."}</small>}
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="form-message">{message}</div>}
      <button disabled={saving || !token || Boolean(message)}>{saving ? "Saving…" : "Update password"}</button>
      <Link className="auth-register" href="/login">Back to login</Link>
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
