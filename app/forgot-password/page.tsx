"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }
  return (
    <main className="password-page">
      <form onSubmit={submit}>
        <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={190} height={70} /></a>
        <h1>Forgot password?</h1>
        <p>Enter your account email. If it is registered, Healthfield will send password-reset instructions.</p>
        <label>Email address<input name="email" type="email" required /></label>
        {sent && <div className="form-message">If this email is registered, reset instructions will be sent.</div>}
        <button>Send reset instructions</button>
        <a className="auth-register" href="/login">Back to login</a>
      </form>
    </main>
  );
}
