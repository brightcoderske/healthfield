"use client";

import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload = { firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email"), phone: form.get("phone"), password: form.get("password"), acceptTerms: form.get("acceptTerms") === "on", marketingConsent: form.get("marketingConsent") === "on" };
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "Registration could not be completed.");
      window.location.assign(data.redirectTo || "/#products");
    } catch {
      setError("Registration could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="register-page"><form onSubmit={submit}><a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={240} height={85}/></a><span className="auth-kicker">Customer account</span><h1>Create your account</h1><p>Track orders, save products and chat with our pharmacy team.</p><div><label>First name<input name="firstName" required/></label><label>Last name<input name="lastName" required/></label><label>Email<input name="email" type="email" required/></label><label>Phone<input name="phone" required/></label><label className="full">Password<span className="password-field"><input name="password" type={showPassword ? "text" : "password"} minLength={8} required/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff/> : <Eye/>}</button></span><small>At least 8 characters with uppercase, lowercase and a number.</small></label><label className="full consent-check"><input name="acceptTerms" type="checkbox" defaultChecked required/><span>I agree to the <a href="/terms" target="_blank">Terms and Conditions</a> and acknowledge the <a href="/privacy-policy" target="_blank">Privacy Policy</a>.</span></label><label className="full consent-check optional"><input name="marketingConsent" type="checkbox" defaultChecked/><span>Email me Healthfield offers, product news and health promotions. I can unsubscribe at any time.</span></label></div>{error ? <div className="auth-error">{error}</div> : null}<button disabled={loading}>{loading ? "Creating account…" : "Create account"}</button><a href="/login">Already registered? Log in</a></form></main>;
}
