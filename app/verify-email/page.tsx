"use client";

import { AlertCircle, Check, LogIn, MailCheck, RefreshCw, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

type ActivationResponse = { error?: string; message?: string; code?: string; retryAfterSeconds?: number };
type ScreenState = "awaiting" | "verifying" | "activated" | "error";

function ActivationContent() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const registered = params.get("sent") === "1";
  const deliveryFailed = params.get("delivery") === "failed";
  const [screen, setScreen] = useState<ScreenState>(token ? "verifying" : "awaiting");
  const [message, setMessage] = useState(deliveryFailed ? "We could not send the first activation email. Use the button below to send a fresh link." : "");
  const [deliveryProblem, setDeliveryProblem] = useState(deliveryFailed);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(deliveryFailed ? 0 : registered ? 60 : 0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) as ActivationResponse }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        setScreen(ok ? "activated" : "error");
        setMessage(data.message || data.error || "Email activation could not be completed.");
      })
      .catch(() => {
        if (cancelled) return;
        setScreen("error");
        setMessage("We could not reach the activation service. Please try again.");
      });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || resending || cooldown > 0) return;
    setResending(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({})) as ActivationResponse;
      if (!response.ok) {
        setDeliveryProblem(data.code === "ACTIVATION_DELIVERY_FAILED");
        if (data.code === "ACTIVATION_COOLDOWN" && typeof data.retryAfterSeconds === "number") setCooldown(data.retryAfterSeconds);
        setMessage(data.error || "A new activation email could not be sent.");
        return;
      }
      setCooldown(typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : 60);
      setDeliveryProblem(false);
      setMessage(data.message || `A fresh activation link has been sent to ${email}.`);
      setScreen("awaiting");
    } catch {
      setDeliveryProblem(true);
      setMessage("We could not send a new activation email. Please try again.");
    } finally {
      setResending(false);
    }
  }

  const activated = screen === "activated";
  const verifying = screen === "verifying";
  const heading = activated ? "Your account is ready" : verifying ? "Activating your account" : registered ? "Thank you for signing up" : "Activate your account";
  const description = activated
    ? message
    : verifying
      ? "Please wait while we securely verify your email address."
      : email
        ? <>We sent an activation link to <strong>{email}</strong>. Kindly check your inbox and select the link to activate your account.</>
        : "Kindly check your inbox and select the activation link we sent to your email address.";

  return <main className="verify-page"><section className="registration-notice"><Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={82}/></Link><span className={`registration-mail-icon ${screen === "error" || deliveryProblem ? "is-error" : ""}`}>{screen === "error" || deliveryProblem ? <AlertCircle/> : activated || registered ? <Check/> : <MailCheck/>}</span><h1>{heading}</h1><p>{description}</p>{!activated && !verifying ? <small>The secure activation link expires after 24 hours. You can request a new one if it does not arrive.</small> : null}{message && !activated ? <div className={screen === "error" || deliveryProblem ? "activation-error" : "activation-message"} role="status">{message}</div> : null}{email && !activated && !verifying ? <form className="activation-resend" onSubmit={resend}><button type="submit" disabled={resending || cooldown > 0}><RefreshCw/>{resending ? "Sending…" : cooldown > 0 ? `Send again in ${cooldown}s` : "Send a new activation link"}</button></form> : null}<div className="activation-actions"><Link className="verify-login" href="/login"><LogIn/>Continue to login</Link><Link className="verify-guest" href="/#products"><ShoppingBag/>Shop as a guest</Link></div></section></main>;
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<main className="verify-page"><section className="registration-notice">Loading…</section></main>}><ActivationContent/></Suspense>;
}
