"use client";

import { ArrowLeft, Eye, EyeOff, KeyRound, LockKeyhole, Mail } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

const twoFactorStorageKey = "healthfield.login.two-factor";
type StoredChallenge = { challengeToken: string; maskedEmail: string; expiresAtMs: number; resendAvailableAtMs: number; challengeEndsAtMs: number };
type AuthResponse = { error?: string; code?: string; retryAfterSeconds?: number; redirectTo?: string; requiresTwoFactor?: boolean; challengeToken?: string; maskedEmail?: string; expiresAtMs?: number; resendAvailableAtMs?: number; challengeEndsAtMs?: number };

export function LoginForm() {
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [activationEmail, setActivationEmail] = useState("");
  const [expiresAtMs, setExpiresAtMs] = useState(0);
  const [resendAvailableAtMs, setResendAvailableAtMs] = useState(0);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const loginInFlight = useRef(false);
  const verificationInFlight = useRef(false);
  const freshLoginStarted = useRef(false);
  const urlError = searchParams.get("error");

  function clearChallenge() {
    sessionStorage.removeItem(twoFactorStorageKey);
    setChallengeToken(""); setMaskedEmail(""); setSecurityCode(""); setExpiresAtMs(0); setResendAvailableAtMs(0);
  }

  useEffect(() => {
    if (freshLoginStarted.current) return;
    let restoreTimer: number | undefined;
    try {
      const stored = JSON.parse(sessionStorage.getItem(twoFactorStorageKey) || "null") as StoredChallenge | null;
      if (stored && /^.{60,100}$/.test(stored.challengeToken) && stored.maskedEmail && Number.isFinite(stored.expiresAtMs) && Number.isFinite(stored.resendAvailableAtMs) && Number.isFinite(stored.challengeEndsAtMs) && stored.challengeEndsAtMs > Date.now()) {
        restoreTimer = window.setTimeout(() => {
          setChallengeToken(stored.challengeToken);
          setMaskedEmail(stored.maskedEmail);
          setExpiresAtMs(stored.expiresAtMs);
          setResendAvailableAtMs(stored.resendAvailableAtMs);
          setClockMs(Date.now());
        }, 0);
      } else sessionStorage.removeItem(twoFactorStorageKey);
    } catch { sessionStorage.removeItem(twoFactorStorageKey); }
    return () => { if (restoreTimer !== undefined) window.clearTimeout(restoreTimer); };
  }, []);

  useEffect(() => {
    if (!challengeToken) return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challengeToken]);

  const secondsRemaining = Math.max(0, Math.ceil((expiresAtMs - clockMs) / 1000));
  const resendWaitSeconds = Math.max(0, Math.ceil((resendAvailableAtMs - clockMs) / 1000));
  const codeExpired = Boolean(challengeToken) && secondsRemaining === 0;
  const expiryLabel = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    freshLoginStarted.current = true;
    sessionStorage.removeItem(twoFactorStorageKey);
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const submittedEmail = String(form.get("email") || "").trim().toLowerCase();
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) {
        setActivationEmail(data.code === "EMAIL_NOT_VERIFIED" ? submittedEmail : "");
        setError(data.error ?? "Login could not be completed. Check your details and try again.");
        setLoading(false);
        return;
      }
      setActivationEmail("");
      if (data.requiresTwoFactor) {
        if (typeof data.challengeToken !== "string" || typeof data.maskedEmail !== "string" || typeof data.expiresAtMs !== "number" || typeof data.resendAvailableAtMs !== "number" || typeof data.challengeEndsAtMs !== "number") throw new Error("Invalid two-factor challenge response.");
        const stored = { challengeToken: data.challengeToken, maskedEmail: data.maskedEmail, expiresAtMs: data.expiresAtMs, resendAvailableAtMs: data.resendAvailableAtMs, challengeEndsAtMs: data.challengeEndsAtMs } satisfies StoredChallenge;
        sessionStorage.setItem(twoFactorStorageKey, JSON.stringify(stored));
        setChallengeToken(data.challengeToken);
        setMaskedEmail(data.maskedEmail);
        setExpiresAtMs(data.expiresAtMs);
        setResendAvailableAtMs(data.resendAvailableAtMs);
        setClockMs(Date.now());
        setLoading(false);
        return;
      }
      sessionStorage.removeItem(twoFactorStorageKey);
      const requested = searchParams.get("next");
      const safeRequested=requested?.startsWith("/")&&!requested.startsWith("//")?requested:null;
      if (typeof data.redirectTo !== "string" || !data.redirectTo.startsWith("/") || data.redirectTo.startsWith("//")) throw new Error("Invalid login redirect.");
      window.location.assign(data.redirectTo === "/change-password" ? data.redirectTo : safeRequested || data.redirectTo);
    } catch {
      setError("Healthfield could not connect to the login service. Please try again.");
      setLoading(false);
    } finally { loginInFlight.current = false; }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationInFlight.current || !challengeToken || securityCode.length !== 6 || codeExpired) return;
    verificationInFlight.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, code: securityCode }) });
      const data = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) {
        const message = String(data.error ?? "The security code could not be verified.");
        if (data.code === "TWO_FACTOR_ENDED") {
          clearChallenge();
          setError("That verification request has ended. Sign in again to receive a fresh code.");
          setLoading(false);
          return;
        }
        setSecurityCode("");
        setError(message); setLoading(false); return;
      }
      if (typeof data.redirectTo !== "string" || !data.redirectTo.startsWith("/") || data.redirectTo.startsWith("//")) throw new Error("Invalid verification redirect.");
      sessionStorage.removeItem(twoFactorStorageKey);
      window.location.assign(data.redirectTo);
    } catch { setError("Healthfield could not verify the security code. Please try again."); setLoading(false); }
    finally { verificationInFlight.current = false; }
  }

  async function resendCode() {
    if (!challengeToken || loading || resendWaitSeconds > 0) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/two-factor-resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken }) });
      const data = await response.json().catch(() => ({})) as AuthResponse;
      if (!response.ok) {
        if (data.code === "TWO_FACTOR_ENDED" || data.code === "TWO_FACTOR_DELIVERY_FAILED") clearChallenge();
        if (data.code === "TWO_FACTOR_COOLDOWN" && typeof data.retryAfterSeconds === "number") setResendAvailableAtMs(Date.now() + data.retryAfterSeconds * 1000);
        setError(data.error ?? "A new code could not be sent.");
      } else {
        if (typeof data.expiresAtMs !== "number" || typeof data.resendAvailableAtMs !== "number" || typeof data.challengeEndsAtMs !== "number") throw new Error("Invalid resend response.");
        const stored = { challengeToken, maskedEmail, expiresAtMs: data.expiresAtMs, resendAvailableAtMs: data.resendAvailableAtMs, challengeEndsAtMs: data.challengeEndsAtMs } satisfies StoredChallenge;
        sessionStorage.setItem(twoFactorStorageKey, JSON.stringify(stored));
        setSecurityCode(""); setExpiresAtMs(data.expiresAtMs); setResendAvailableAtMs(data.resendAvailableAtMs); setClockMs(Date.now()); setNotice("A fresh code was sent. Only this new code will work.");
      }
    } catch { setError("A new code could not be sent. Please try again."); }
    setLoading(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={260} height={92} priority /></Link>
        <span className="auth-kicker">Healthfield Pharmacy</span>
        <h1>{challengeToken ? "Security verification" : "Log in"}</h1>
        {challengeToken ? <>
          <p className="two-factor-intro">Enter the six-digit code sent to <strong>{maskedEmail}</strong>. The newest email contains the only valid code.</p>
          <div className={`two-factor-timer${codeExpired ? " is-expired" : ""}`} role="status"><span>{codeExpired ? "Code expired" : "Code expires in"}</span><strong>{codeExpired ? "Send a new code" : expiryLabel}</strong></div>
          <form onSubmit={verifyCode} className="two-factor-form">
            <label><span>Security code</span><div className="two-factor-code-field"><KeyRound /><input className="two-factor-code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={securityCode} onChange={(event) => { setSecurityCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} aria-describedby="two-factor-help" autoFocus required /></div></label>
            <small id="two-factor-help" className="two-factor-help">You can type or paste the code from your email.</small>
            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-notice" role="status">{notice}</div>}
            <button className="auth-submit" disabled={loading || securityCode.length !== 6 || codeExpired}>{loading ? "Verifying…" : codeExpired ? "Code expired" : "Verify and continue"}</button>
          </form>
          <div className="two-factor-options"><button type="button" onClick={resendCode} disabled={loading || resendWaitSeconds > 0}>{resendWaitSeconds > 0 ? `Send again in ${resendWaitSeconds}s` : "Send a new code"}</button><button type="button" onClick={() => { clearChallenge(); setError(""); setNotice(""); }}><ArrowLeft /> Back to login</button></div>
        </> : <><form onSubmit={submit} method="post" action="/api/auth/login">
          <label><span>Email address</span><div><Mail /><input name="email" type="email" autoComplete="email" required /></div></label>
          <label><span>Password</span><div><LockKeyhole /><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {(error || urlError) && <div className="auth-error" role="alert">{error || (urlError === "incorrect" ? "Incorrect email or password." : urlError === "session_expired" ? "Your previous session is no longer valid. Sign in again securely." : "Enter a valid email and password.")}</div>}
          {activationEmail ? <Link className="activation-help-link" href={`/verify-email?email=${encodeURIComponent(activationEmail)}`}>Send me a new activation link</Link> : null}
          <a className="forgot-password" href="/forgot-password">Forgot password?</a>
          <button className="auth-submit" disabled={loading}>{loading ? "Signing in…" : "Log in"}</button>
        </form>
        <Link className="auth-register" href="/register">New here? <strong>Sign up</strong></Link>
        <Link className="auth-guest" href="/">Continue shopping as guest</Link>
        </>}
      </section>
      <aside><div><span>Healthfield Pharmacy</span><h2>Order medicines and health essentials online.</h2><p>Log in to view your orders, saved products and prescriptions.</p></div></aside>
    </main>
  );
}
