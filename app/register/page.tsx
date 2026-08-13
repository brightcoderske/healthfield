"use client";

import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { safeLocalPath } from "@/lib/prescription-selection";

type RegistrationResponse = { error?: string; redirectTo?: string };

function RegisterContent() {
  const params = useSearchParams();
  const requested = params.get("next");
  const safeRequested = requested ? safeLocalPath(requested, "") : "";
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
      const payload = {
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        email: form.get("email"),
        phone: form.get("phone"),
        password: form.get("password"),
        acceptTerms: form.get("acceptTerms") === "on",
        marketingConsent: form.get("marketingConsent") === "on",
      };
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as RegistrationResponse;
      if (!response.ok)
        return setError(data.error || "Registration could not be completed.");
      if (
        typeof data.redirectTo !== "string" ||
        !data.redirectTo.startsWith("/verify-email?") ||
        data.redirectTo.startsWith("//")
      )
        throw new Error("Invalid registration redirect.");
      const redirect = new URL(data.redirectTo, window.location.origin);
      if (safeRequested) redirect.searchParams.set("next", safeRequested);
      window.location.assign(`${redirect.pathname}${redirect.search}`);
    } catch {
      setError("Registration could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="register-page">
      <form onSubmit={submit}>
        <Link href="/">
          <Image
            src="/healthfield-logo-clean.png"
            alt="Healthfield Pharmacy"
            width={240}
            height={85}
          />
        </Link>
        <span className="auth-kicker">Customer account</span>
        <h1>Create your account</h1>
        <p>Track orders, save products and chat with our pharmacy team.</p>
        <div>
          <label>
            First name
            <input name="firstName" autoComplete="given-name" required />
          </label>
          <label>
            Last name
            <input name="lastName" autoComplete="family-name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" autoComplete="tel" required />
          </label>
          <label className="full">
            Password
            <span className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </span>
            <small>
              At least 8 characters with uppercase, lowercase and a number.
            </small>
          </label>
          <label className="full consent-check">
            <input name="acceptTerms" type="checkbox" defaultChecked required />
            <span>
              I agree to the{" "}
              <Link href="/terms" target="_blank">
                Terms and Conditions
              </Link>{" "}
              and acknowledge the{" "}
              <Link href="/privacy-policy" target="_blank">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          <label className="full consent-check optional">
            <input name="marketingConsent" type="checkbox" defaultChecked />
            <span>
              Email me Healthfield offers, product news and health promotions. I
              can unsubscribe at any time.
            </span>
          </label>
        </div>
        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <button disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>
        <Link
          href={
            safeRequested
              ? `/login?next=${encodeURIComponent(safeRequested)}`
              : "/login"
          }
        >
          Already registered? Log in
        </Link>
      </form>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="register-page" />}>
      <RegisterContent />
    </Suspense>
  );
}
