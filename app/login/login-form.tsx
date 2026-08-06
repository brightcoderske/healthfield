"use client";

import { ArrowLeft, Eye, EyeOff, KeyRound, LockKeyhole, Mail } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

const twoFactorStorageKey = "healthfield.login.two-factor";
type StoredChallenge = { challengeToken: string; maskedEmail: string };

export function LoginForm() {
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const loginInFlight = useRef(false);
  const verificationInFlight = useRef(false);
  const freshLoginStarted = useRef(false);
  const urlError = searchParams.get("error");

  function clearChallenge() {
    sessionStorage.removeItem(twoFactorStorageKey);
    setChallengeToken(""); setMaskedEmail(""); setSecurityCode(""); setDevelopmentCode("");
  }

  useEffect(() => {
    if (freshLoginStarted.current) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(twoFactorStorageKey) || "null") as StoredChallenge | null;
      if (stored && /^.{60,100}$/.test(stored.challengeToken) && stored.maskedEmail) {
        setChallengeToken(stored.challengeToken);
        setMaskedEmail(stored.maskedEmail);
      } else sessionStorage.removeItem(twoFactorStorageKey);
    } catch { sessionStorage.removeItem(twoFactorStorageKey); }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    freshLoginStarted.current = true;
    sessionStorage.removeItem(twoFactorStorageKey);
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
      if (data.requiresTwoFactor) {
        if (typeof data.challengeToken !== "string" || typeof data.maskedEmail !== "string") throw new Error("Invalid two-factor challenge response.");
        sessionStorage.setItem(twoFactorStorageKey, JSON.stringify({ challengeToken: data.challengeToken, maskedEmail: data.maskedEmail } satisfies StoredChallenge));
        setChallengeToken(data.challengeToken);
        setMaskedEmail(data.maskedEmail);
        setDevelopmentCode(data.developmentCode || "");
        setLoading(false);
        return;
      }
      sessionStorage.removeItem(twoFactorStorageKey);
      const requested = searchParams.get("next");
      const safeRequested=requested?.startsWith("/")&&!requested.startsWith("//")?requested:null;
      window.location.assign(data.redirectTo === "/change-password" ? data.redirectTo : safeRequested || data.redirectTo);
    } catch {
      setError("Healthfield could not connect to the login service. Please try again.");
      setLoading(false);
    } finally { loginInFlight.current = false; }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationInFlight.current || !challengeToken) return;
    verificationInFlight.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, code: securityCode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(data.error ?? "The security code could not be verified.");
        if (message.includes("already been completed")) {
          clearChallenge();
          setError("This verification request has already ended. Please sign in again to receive a new code.");
          setLoading(false);
          return;
        }
        setError(message); setLoading(false); return;
      }
      sessionStorage.removeItem(twoFactorStorageKey);
      window.location.assign(data.redirectTo);
    } catch { setError("Healthfield could not verify the security code. Please try again."); setLoading(false); }
    finally { verificationInFlight.current = false; }
  }

  async function resendCode() {
    setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/two-factor-resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? "A new code could not be sent."); else { setSecurityCode(""); setDevelopmentCode(data.developmentCode || ""); setNotice("A new code was sent. It is valid for 10 minutes."); }
    } catch { setError("A new code could not be sent. Please try again."); }
    setLoading(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={260} height={92} priority /></a>
        <span className="auth-kicker">Healthfield Pharmacy</span>
        <h1>{challengeToken ? "Security verification" : "Log in"}</h1>
        {challengeToken ? <>
          <p className="two-factor-intro">For staff account protection, enter the one-time code sent to <strong>{maskedEmail}</strong>.</p>
          {developmentCode && <div className="auth-notice" role="status">Local development code: <strong>{developmentCode}</strong></div>}
          <form onSubmit={verifyCode} className="two-factor-form">
            <label><span>6-digit security code</span><div><KeyRound /><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus required /></div></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-notice" role="status">{notice}</div>}
            <button className="auth-submit" disabled={loading}>{loading ? "Verifying…" : "Verify and continue"}</button>
          </form>
          <div className="two-factor-options"><button type="button" onClick={resendCode} disabled={loading}>Send another code</button><button type="button" onClick={() => { clearChallenge(); setError(""); setNotice(""); }}><ArrowLeft /> Back to login</button></div>
        </> : <><form onSubmit={submit} method="post" action="/api/auth/login">
          <label><span>Email address</span><div><Mail /><input name="email" type="email" autoComplete="email" required /></div></label>
          <label><span>Password</span><div><LockKeyhole /><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {(error || urlError) && <div className="auth-error" role="alert">{error || (urlError === "incorrect" ? "Incorrect email or password." : urlError === "session_expired" ? "Your previous session is no longer valid. Sign in again securely." : "Enter a valid email and password.")}</div>}
          <a className="forgot-password" href="/forgot-password">Forgot password?</a>
          <button className="auth-submit" disabled={loading}>{loading ? "Signing in…" : "Log in"}</button>
        </form>
        <a className="auth-register" href="/register">New here? <strong>Sign up</strong></a>
        <a className="auth-guest" href="/">Continue shopping as guest</a>
        </>}
      </section>
      <aside><div><span>Healthfield Pharmacy</span><h2>Order medicines and health essentials online.</h2><p>Log in to view your orders, saved products and prescriptions.</p></div></aside>
    </main>
  );
}
