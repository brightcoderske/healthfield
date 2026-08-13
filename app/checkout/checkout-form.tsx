"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clipboard,
  CreditCard,
  LoaderCircle,
  LocateFixed,
  MapPin,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { prescriptionUploadHref } from "@/lib/prescription-selection";

type Product = {
  id: number;
  name: string;
  price: string;
  discountPrice: string | null;
  packSize: string | null;
  prescriptionRequired: boolean;
};
type Customer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
} | null;
type PaymentOptions = {
  onlineMpesaEnabled: boolean;
  onlineManualEnabled: boolean;
  tillNumber: string | null;
  accountName: string | null;
};
export type CheckoutOffer = {
  id: number;
  title: string;
  total: number;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
    prescriptionRequired: boolean;
  }>;
};
type PaymentMethod = "MPESA_EXPRESS" | "MANUAL_MPESA";
type CheckoutResult = {
  id: number;
  orderNumber: string;
  total: number;
  state: "WAITING" | "REVIEW" | "PAID" | "FAILED";
  message: string;
};

async function clearCheckoutCart() {
  await fetch("/api/cart", { method: "DELETE" }).catch(() => undefined);
}

export function CheckoutForm({
  initialCart,
  initialCatalog,
  initialOffers = [],
  customer,
  payment,
}: {
  initialCart: Record<number, number>;
  initialCatalog: Product[];
  initialOffers?: CheckoutOffer[];
  customer: Customer;
  payment: PaymentOptions;
}) {
  const initialPayment: PaymentMethod = payment.onlineMpesaEnabled
    ? "MPESA_EXPRESS"
    : "MANUAL_MPESA";
  const [method, setMethod] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>(initialPayment);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [retryPhone, setRetryPhone] = useState(customer?.phone ?? "");
  const checkoutToken = useRef(
    globalThis.crypto?.randomUUID?.() ?? crypto.randomUUID(),
  );
  const pollCount = useRef(0);
  const allLines = useMemo(
    () =>
      Object.entries(initialCart)
        .map(([id, quantity]) => ({
          product: initialCatalog.find((item) => item.id === Number(id)),
          quantity,
        }))
        .filter((line) => line.product),
    [initialCart, initialCatalog],
  );
  const lines = allLines.filter((line) => !line.product!.prescriptionRequired);
  const prescriptionLines = allLines.filter(
    (line) => line.product!.prescriptionRequired,
  );
  const offers = initialOffers.filter(
    (offer) => !offer.items.some((item) => item.prescriptionRequired),
  );
  const prescriptionOffers = initialOffers.filter((offer) =>
    offer.items.some((item) => item.prescriptionRequired),
  );
  const prescriptionUploadUrl = prescriptionUploadHref([
    ...prescriptionLines.map((line) => ({
      id: line.product!.id,
      name: line.product!.name,
      quantity: line.quantity,
    })),
    ...prescriptionOffers.flatMap((offer) =>
      offer.items
        .filter((item) => item.prescriptionRequired)
        .map((item) => ({
          id: item.productId,
          name: item.name,
          quantity: item.quantity,
        })),
    ),
  ]);
  // A bundle counts as a single line priced by the offer, never per component.
  const bundleTotal = offers.reduce(
    (sum, offer) => sum + Number(offer.total),
    0,
  );
  const subtotal =
    lines.reduce(
      (sum, line) =>
        sum +
        Number(line.product!.discountPrice ?? line.product!.price) *
          line.quantity,
      0,
    ) + bundleTotal;
  const total = subtotal + (method === "DELIVERY" ? 250 : 0);

  useEffect(() => {
    if (result?.state !== "WAITING") return;
    let cancelled = false;
    async function check() {
      pollCount.current += 1;
      const response = await fetch("/api/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutToken: checkoutToken.current }),
      }).catch(() => null);
      if (!response || cancelled) return;
      const data = await response.json().catch(() => ({}));
      if (data.paid || data.order?.paymentStatus === "PAID") {
        await clearCheckoutCart();
        if (!cancelled)
          setResult((current) =>
            current
              ? {
                  ...current,
                  state: "PAID",
                  message: `M-Pesa payment confirmed. Receipt ${data.order?.paymentReference || "received"}.`,
                }
              : current,
          );
      } else if (data.failed || data.order?.paymentStatus === "FAILED") {
        if (!cancelled)
          setResult((current) =>
            current
              ? {
                  ...current,
                  state: "FAILED",
                  message:
                    data.message ||
                    data.payment?.resultDescription ||
                    "The M-Pesa payment was not completed.",
                }
              : current,
          );
      } else if (pollCount.current >= 24 && !cancelled) {
        setResult((current) =>
          current
            ? {
                ...current,
                state: "FAILED",
                message:
                  "We could not confirm the M-Pesa prompt. You can submit the till payment message below.",
              }
            : current,
        );
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [result?.state]);

  function locate() {
    if (!navigator.geolocation)
      return setError("Location services are not available on this device.");
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setError("Allow location access, then try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  async function copyTill() {
    if (!payment.tillNumber) return;
    try {
      await navigator.clipboard.writeText(payment.tillNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError(`Copy the till number manually: ${payment.tillNumber}`);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || result) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = form.get(name);
      return typeof entry === "string" ? entry : undefined;
    };
    if (!customer && !String(value("email") || "").trim())
      return setError(
        "Enter your email so this guest order can appear in your account if you register later.",
      );
    setRetryPhone(value("billingPhone") || value("phone") || "");
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkoutToken: checkoutToken.current,
          fullName: value("fullName"),
          phone: value("phone"),
          email: value("email"),
          fulfilmentMethod: method,
          paymentMethod,
          billingPhone: value("billingPhone"),
          manualPaymentMessage:
            paymentMethod === "MANUAL_MPESA" ? manualMessage.trim() : undefined,
          deliveryAddress: value("deliveryAddress"),
          deliveryArea: value("deliveryArea"),
          deliveryLatitude: coordinates?.latitude,
          deliveryLongitude: coordinates?.longitude,
          items: lines.map((line) => ({
            productId: line.product!.id,
            quantity: line.quantity,
          })),
          offerItems: offers.map((offer) => ({ offerId: offer.id })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        return setError(data.error ?? "Unable to start checkout.");
      const nextState =
        data.paymentStatus === "PAID"
          ? "PAID"
          : paymentMethod === "MANUAL_MPESA"
            ? "REVIEW"
            : data.paymentStatus === "FAILED"
              ? "FAILED"
              : "WAITING";
      setResult({
        id: data.id,
        orderNumber: data.orderNumber,
        total: Number(data.total),
        state: nextState,
        message: data.paymentMessage || "Payment request started.",
      });
      if (nextState === "REVIEW") await clearCheckoutCart();
    } catch {
      setError("Unable to reach checkout. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryPayment() {
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/payments/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkoutToken: checkoutToken.current,
        billingPhone: retryPhone,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setError(data?.error || "The payment prompt could not be sent.");
    } else if (
      data.paymentStatus === "PAID" ||
      data.order?.paymentStatus === "PAID"
    ) {
      await clearCheckoutCart();
      setResult((current) =>
        current
          ? {
              ...current,
              state: "PAID",
              message: "Payment confirmed. Your order is now being processed.",
            }
          : current,
      );
    } else {
      checkoutToken.current = data.checkoutToken || checkoutToken.current;
      pollCount.current = 0;
      setResult((current) =>
        current
          ? {
              ...current,
              state: "WAITING",
              message:
                data.message || "Approve the new payment prompt on your phone.",
            }
          : current,
      );
    }
    setSubmitting(false);
  }

  async function submitFallback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/payments/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkoutToken: checkoutToken.current,
        message: manualMessage,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok)
      setError(data?.error || "Payment proof could not be submitted.");
    else {
      await clearCheckoutCart();
      setResult((current) =>
        current
          ? {
              ...current,
              state: data.paid ? "PAID" : "REVIEW",
              message: data.message,
            }
          : current,
      );
    }
    setSubmitting(false);
  }

  const tillPanel = payment.onlineManualEnabled ? (
    <div className="manual-payment-panel">
      <div>
        <span>Pay to M-Pesa Till</span>
        <strong>{payment.tillNumber}</strong>
        <small>{payment.accountName || "Healthfield Pharmacy"}</small>
      </div>
      <button type="button" onClick={copyTill}>
        {copied ? <Check /> : <Clipboard />}
        {copied ? "Copied" : "Copy till"}
      </button>
      <p>
        Amount to pay: <strong>KES {total.toLocaleString()}</strong>
      </p>
      <label>
        Paste the complete M-Pesa confirmation message
        <textarea
          value={manualMessage}
          onChange={(event) => setManualMessage(event.target.value)}
          rows={4}
          placeholder="Paste the message showing the transaction code, amount and till payment"
          required
        />
      </label>
    </div>
  ) : null;

  if (result)
    return (
      <main
        className={`checkout-success payment-result payment-${result.state.toLowerCase()}`}
      >
        {result.state === "WAITING" ? (
          <LoaderCircle className="spin" />
        ) : result.state === "FAILED" ? (
          <ReceiptText />
        ) : (
          <CheckCircle2 />
        )}
        <span>{result.orderNumber}</span>
        <h1>
          {result.state === "PAID"
            ? "Payment confirmed — order placed"
            : result.state === "REVIEW"
              ? "Payment proof received"
              : result.state === "WAITING"
                ? "Approve payment on your phone"
                : "Payment not completed"}
        </h1>
        <p>{result.message}</p>
        <strong>KES {result.total.toLocaleString()}</strong>
        {result.state === "REVIEW" ? (
          <small>
            An administrator will verify the M-Pesa code and approve the order
            before processing begins.
          </small>
        ) : null}
        {result.state === "FAILED" && payment.onlineMpesaEnabled ? (
          <section className="payment-retry">
            <h2>Try the phone prompt again</h2>
            <label>
              Phone number
              <input
                type="tel"
                inputMode="tel"
                value={retryPhone}
                onChange={(event) => setRetryPhone(event.target.value)}
              />
            </label>
            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null}
            <button
              type="button"
              disabled={submitting || retryPhone.trim().length < 9}
              onClick={retryPayment}
            >
              <RefreshCw />
              {submitting ? "Sending…" : "Retry M-Pesa"}
            </button>
          </section>
        ) : null}
        {result.state === "FAILED" && payment.onlineManualEnabled ? (
          <form className="payment-fallback" onSubmit={submitFallback}>
            <h2>Or use manual M-Pesa payment</h2>
            {tillPanel}
            {!payment.onlineMpesaEnabled && error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null}
            <button disabled={submitting || manualMessage.trim().length < 10}>
              {submitting ? "Submitting…" : "Submit payment proof"}
            </button>
          </form>
        ) : null}
        <div>
          <Link href="/#products">
            <ShoppingBag /> Continue shopping
          </Link>
          {result.state !== "WAITING" ? (
            <Link href={customer ? "/account#orders" : "/login"}>
              View order
            </Link>
          ) : null}
        </div>
      </main>
    );

  const noPayments =
    !payment.onlineMpesaEnabled && !payment.onlineManualEnabled;
  return (
    <main className="checkout-page">
      <header>
        <Link href="/#products">
          <ArrowLeft /> Shop
        </Link>
        <Image
          src="/healthfield-logo-clean.png"
          alt="Healthfield Pharmacy"
          width={210}
          height={75}
        />
        <Link href={customer ? "/account" : "/login?next=/checkout"}>
          {customer ? `Hi, ${customer.firstName}` : "Sign in"}
        </Link>
      </header>
      <div className="checkout-layout">
        <form onSubmit={submit}>
          <span className="auth-kicker">Secure checkout</span>
          <h1>Delivery details</h1>
          <div className="checkout-methods">
            <button
              type="button"
              className={method === "DELIVERY" ? "active" : ""}
              onClick={() => setMethod("DELIVERY")}
            >
              <MapPin /> Home delivery
            </button>
            <button
              type="button"
              className={method === "PICKUP" ? "active" : ""}
              onClick={() => setMethod("PICKUP")}
            >
              <ShoppingCart /> Pickup
            </button>
          </div>
          <div className="checkout-fields">
            <label>
              Full name
              <input
                name="fullName"
                autoComplete="name"
                defaultValue={
                  customer ? `${customer.firstName} ${customer.lastName}` : ""
                }
                required
              />
            </label>
            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={customer?.phone ?? ""}
                required
              />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={customer?.email ?? ""}
              />
            </label>
            <label>
              Town or area
              <input name="deliveryArea" required={method === "DELIVERY"} />
            </label>
            {method === "DELIVERY" ? (
              <>
                <label className="full">
                  Delivery address
                  <textarea name="deliveryAddress" rows={3} required />
                </label>
                <div className="checkout-location full">
                  <button type="button" onClick={locate} disabled={locating}>
                    <LocateFixed />
                    {locating
                      ? "Getting location…"
                      : coordinates
                        ? "Location captured"
                        : "Use my current location"}
                  </button>
                  {coordinates ? (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.google.com/maps?q=${coordinates.latitude},${coordinates.longitude}`}
                    >
                      Preview on Google Maps
                    </a>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
          {prescriptionLines.length || prescriptionOffers.length ? (
            <div className="checkout-prescription-warning" role="alert">
              <strong>Prescription medicine excluded from this checkout</strong>
              <span>
                Upload the prescription so a pharmacist can review and price it
                separately.
              </span>
              <Link
                className="prescription-attention-link"
                href={prescriptionUploadUrl}
              >
                Upload prescription
              </Link>
            </div>
          ) : null}
          <h2>Payment method</h2>
          <div className="payment-options">
            {payment.onlineMpesaEnabled ? (
              <label
                className={`payment-choice ${paymentMethod === "MPESA_EXPRESS" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="payment"
                  value="MPESA_EXPRESS"
                  checked={paymentMethod === "MPESA_EXPRESS"}
                  onChange={() => setPaymentMethod("MPESA_EXPRESS")}
                />
                <Smartphone />
                <span>
                  <strong>M-Pesa Express</strong>
                  <small>Receive a secure STK prompt on your phone</small>
                </span>
              </label>
            ) : null}
            {payment.onlineManualEnabled ? (
              <label
                className={`payment-choice ${paymentMethod === "MANUAL_MPESA" ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="payment"
                  value="MANUAL_MPESA"
                  checked={paymentMethod === "MANUAL_MPESA"}
                  onChange={() => setPaymentMethod("MANUAL_MPESA")}
                />
                <CreditCard />
                <span>
                  <strong>Manual M-Pesa</strong>
                  <small>
                    Pay to the till and submit the confirmation message
                  </small>
                </span>
              </label>
            ) : null}
          </div>
          {paymentMethod === "MPESA_EXPRESS" && payment.onlineMpesaEnabled ? (
            <label className="billing-phone">
              Phone number to receive the M-Pesa prompt
              <input
                name="billingPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                defaultValue={customer?.phone ?? ""}
                placeholder="0712 345 678"
                required
              />
            </label>
          ) : null}
          {paymentMethod === "MANUAL_MPESA" ? tillPanel : null}
          {noPayments ? (
            <div className="auth-error" role="alert">
              Online payment is temporarily unavailable. Please contact the
              pharmacy.
            </div>
          ) : null}
          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            className="place-order"
            disabled={
              (!lines.length && !offers.length) ||
              submitting ||
              noPayments ||
              (paymentMethod === "MANUAL_MPESA" &&
                manualMessage.trim().length < 10)
            }
          >
            {submitting
              ? "Starting secure payment…"
              : paymentMethod === "MPESA_EXPRESS"
                ? "Pay with M-Pesa"
                : "Submit proof and place order"}
          </button>
        </form>
        <aside>
          <h2>Order summary</h2>
          {offers.map((offer) => (
            <article key={`offer-${offer.id}`} className="checkout-bundle-line">
              <div>
                <strong>{offer.title}</strong>
                <small>Bundle · {offer.items.length} products</small>
              </div>
              <span>KES {Number(offer.total).toLocaleString()}</span>
            </article>
          ))}
          {lines.map((line) => (
            <article key={line.product!.id}>
              <div>
                <strong>{line.product!.name}</strong>
                <small>
                  {line.product!.packSize} · Qty {line.quantity}
                </small>
              </div>
              <span>
                KES{" "}
                {(
                  Number(line.product!.discountPrice ?? line.product!.price) *
                  line.quantity
                ).toLocaleString()}
              </span>
            </article>
          ))}
          {prescriptionLines.map((line) => (
            <article
              key={`rx-${line.product!.id}`}
              className="checkout-prescription-line"
            >
              <div>
                <strong>{line.product!.name}</strong>
                <small>Prescription required · Qty {line.quantity}</small>
              </div>
              <span>Excluded</span>
            </article>
          ))}
          <div className="checkout-total">
            <span>
              Subtotal<b>KES {subtotal.toLocaleString()}</b>
            </span>
            <span>
              Delivery<b>KES {method === "DELIVERY" ? "250" : "0"}</b>
            </span>
            <span>
              Total<strong>KES {total.toLocaleString()}</strong>
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
