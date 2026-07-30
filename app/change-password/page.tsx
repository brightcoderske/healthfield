"use client";

import { FormEvent, useState } from "react";

export default function ChangePasswordPage() {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      setError("New passwords do not match.");
      return;
    }
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error ?? "Unable to update password.");
    window.location.assign(data.redirectTo);
  }
  return (
    <main className="password-page"><form onSubmit={submit}><h1>Secure your account</h1><p>Your temporary password must be replaced before continuing.</p><label>Current password<input name="currentPassword" type="password" required /></label><label>New password<input name="newPassword" type="password" minLength={8} required /></label><label>Confirm new password<input name="confirmPassword" type="password" minLength={8} required /></label>{error && <div className="auth-error">{error}</div>}<button>Update password</button></form></main>
  );
}
