"use client";

import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useState } from "react";

export default function ChangePasswordPage() {
  const [error, setError] = useState("");
  const [visible, setVisible] = useState({ current:false, next:false, confirm:false });
  const toggle = (field:keyof typeof visible) => setVisible((current)=>({...current,[field]:!current[field]}));
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
    <main className="password-page"><form onSubmit={submit}><h1>Secure your account</h1><p>Your temporary password must be replaced before continuing.</p>
      <label>Current password<span className="password-field"><input name="currentPassword" type={visible.current?"text":"password"} autoComplete="current-password" required/><button type="button" onClick={()=>toggle("current")} aria-label={visible.current?"Hide current password":"Show current password"} aria-pressed={visible.current}>{visible.current?<EyeOff/>:<Eye/>}</button></span></label>
      <label>New password<span className="password-field"><input name="newPassword" type={visible.next?"text":"password"} autoComplete="new-password" minLength={8} required/><button type="button" onClick={()=>toggle("next")} aria-label={visible.next?"Hide new password":"Show new password"} aria-pressed={visible.next}>{visible.next?<EyeOff/>:<Eye/>}</button></span></label>
      <label>Confirm new password<span className="password-field"><input name="confirmPassword" type={visible.confirm?"text":"password"} autoComplete="new-password" minLength={8} required/><button type="button" onClick={()=>toggle("confirm")} aria-label={visible.confirm?"Hide confirmed password":"Show confirmed password"} aria-pressed={visible.confirm}>{visible.confirm?<EyeOff/>:<Eye/>}</button></span></label>
      {error && <div className="auth-error">{error}</div>}<button>Update password</button></form></main>
  );
}
