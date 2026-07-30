"use client";

import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const urlError = searchParams.get("error");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Login could not be completed. Check your details and try again.");
        setLoading(false);
        return;
      }
      const requested = searchParams.get("next");
      window.location.assign(data.redirectTo === "/change-password" ? data.redirectTo : requested || data.redirectTo);
    } catch {
      setError("Healthfield could not connect to the login service. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={260} height={92} priority /></a>
        <span className="auth-kicker">Healthfield Pharmacy</span>
        <h1>Log in</h1>
        <form onSubmit={submit} method="post" action="/api/auth/login">
          <label><span>Email address</span><div><Mail /><input name="email" type="email" autoComplete="email" required /></div></label>
          <label><span>Password</span><div><LockKeyhole /><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {(error || urlError) && <div className="auth-error" role="alert">{error || (urlError === "incorrect" ? "Incorrect email or password." : "Enter a valid email and password.")}</div>}
          <a className="forgot-password" href="/forgot-password">Forgot password?</a>
          <button className="auth-submit" disabled={loading}>{loading ? "Signing in…" : "Log in"}</button>
        </form>
        <a className="auth-register" href="/register">New here? <strong>Sign up</strong></a>
        <a className="auth-guest" href="/">Continue shopping as guest</a>
      </section>
      <aside><div><span>Healthfield Pharmacy</span><h2>Order medicines and health essentials online.</h2><p>Log in to view your orders, saved products and prescriptions.</p></div></aside>
    </main>
  );
}
