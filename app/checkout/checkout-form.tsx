"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clipboard,
  CreditCard,
  LoaderCircle,
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
import { manualTillPollDelay, paymentPollDelay } from "@/lib/payment-poll";
import { prescriptionUploadHref } from "@/lib/prescription-selection";
import { MapPicker, type PinnedLocation } from "../map-picker";
import { deliveryFeeOf, useDeliveryQuote, type DeliveryOptions } from "../use-delivery-quote";

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
  delivery,
}: {
  initialCart: Record<number, number>;
  initialCatalog: Product[];
  initialOffers?: CheckoutOffer[];
  customer: Customer;
  payment: PaymentOptions;
  delivery: DeliveryOptions;
}) {
  const initialPayment: PaymentMethod = payment.onlineMpesaEnabled
    ? "MPESA_EXPRESS"
    : "MANUAL_MPESA";
  const [method, setMethod] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>(initialPayment);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [pin, setPin] = useState<PinnedLocation | null>(null);
  // Seeded from the pin's reverse-geocoded address, then editable: the map gets the
  // rider to the street, the customer's own words get them to the door.
  const [address, setAddress] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  // The M-Pesa prompt almost always goes to the number already typed above, so it
  // follows that field until the customer edits it — then it is theirs and stays put.
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [billingPhone, setBillingPhone] = useState(customer?.phone ?? "");
  const [billingPhoneTouched, setBillingPhoneTouched] = useState(false);
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
  // Seeding the address here rather than in an effect keeps the pin and the wording
  // that describes it in a single update, and leaves anything the customer typed alone.
  function pinLocation(location: PinnedLocation | null) {
    setPin(location);
    if (location?.address && !addressTouched) setAddress(location.address);
  }
  // The same basket the server will price, so the preview and the charge cannot
  // disagree about which branch has to fulfil the order.
  const quotedLines = [
    ...lines.map((line) => ({ productId: line.product!.id, quantity: line.quantity })),
    ...offers.flatMap((offer) => offer.items.map((item) => ({ productId: item.productId, quantity: item.quantity }))),
  ];
  const { quote: deliveryQuote, loading: quotingDelivery } = useDeliveryQuote({
    active: method === "DELIVERY",
    pin,
    subtotal,
    items: quotedLines,
  });
  const deliveryFee = deliveryFeeOf(deliveryQuote, delivery, method === "DELIVERY");
  const deliveryBlocked = method === "DELIVERY" && Boolean(deliveryQuote && !deliveryQuote.available);
  const total = subtotal + deliveryFee;

  useEffect(() => {
    if (!result || !["WAITING", "REVIEW"].includes(result.state)) return;
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
      } else if (data.providerConfirmed || (data.payment?.status === "REQUIRES_REVIEW" && data.payment?.resultCode === "0")) {
        if (!cancelled)
          setResult((current) =>
            current
              ? {
                  ...current,
                  message: data.message || "Safaricom confirms payment. Healthfield is completing the order.",
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
      } else if (paymentMethod === "MANUAL_MPESA" && pollCount.current === 6 && !cancelled) {
        await clearCheckoutCart();
        setResult((current) => current ? { ...current, state:"REVIEW", message:"The receipt was not matched immediately. It is now safely queued for administrator review; do not pay again." } : current);
      } else if (pollCount.current === 24 && !cancelled) {
        setResult((current) =>
          current
            ? {
                ...current,
                message:
                  "Safaricom has not returned a final result yet. Healthfield is still checking; do not pay a second time.",
              }
            : current,
        );
      }
    }
    let timer = 0;
    function schedule() {
      if (cancelled) return;
      const delay = paymentMethod === "MANUAL_MPESA" ? manualTillPollDelay(pollCount.current) : paymentPollDelay(pollCount.current);
      timer = window.setTimeout(() => void check().finally(schedule), delay);
    }
    void check().finally(schedule);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [paymentMethod, result?.state]);

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
    // The fee cannot exist without a pin, so this is a hard stop rather than a nudge.
    if (method === "DELIVERY" && !pin)
      return setError(
        "Pin your delivery location on the map so the delivery fee can be calculated.",
      );
    if (deliveryBlocked)
      return setError(
        "Delivery is not available to that location. Choose pharmacy pickup or pin a location inside the delivery area.",
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
          deliveryLatitude: pin?.latitude,
          deliveryLongitude: pin?.longitude,
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
            ? "WAITING"
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
      if (nextState === "PAID") await clearCheckoutCart();
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
      if (data.paid) await clearCheckoutCart();
      setResult((current) =>
        current
          ? {
              ...current,
              state: data.paid ? "PAID" : "WAITING",
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
      <p className="manual-payment-hint">
        Pay that exact amount to the till, then paste the confirmation message Safaricom
        sends you. The code inside it is what links your payment to this order.
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
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  if (!billingPhoneTouched) setBillingPhone(event.target.value);
                }}
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
              <div className="checkout-location full">
                <span className="checkout-location-title">
                  <MapPin /> Where should we deliver?
                </span>
                <p className="checkout-location-note">
                  Search for your area and pick it from the suggestions. The delivery fee
                  is worked out from how far that is from the branch packing your order.
                </p>
                <MapPicker value={pin} onChange={pinLocation} />
                <label className="full">
                  Directions for the rider
                  <textarea
                    name="deliveryAddress"
                    rows={3}
                    required
                    value={address}
                    onChange={(event) => {
                      setAddressTouched(true);
                      setAddress(event.target.value);
                    }}
                    placeholder="House or building name, floor, gate colour, anything that helps the rider find you"
                  />
                  <small>
                    Started from the location you picked. Add whatever a rider still
                    needs once they arrive.
                  </small>
                </label>
                {deliveryQuote && !deliveryQuote.available ? (
                  <div className="auth-error" role="alert">
                    {deliveryQuote.message} Choose pharmacy pickup, or pin a location
                    inside the delivery area.
                  </div>
                ) : null}
                {deliveryQuote?.available && deliveryQuote.courier ? (
                  <p className="checkout-location-courier">
                    Delivered by {deliveryQuote.courier} on Healthfield&rsquo;s behalf.
                  </p>
                ) : null}
              </div>
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
                value={billingPhone}
                onChange={(event) => {
                  setBillingPhoneTouched(true);
                  setBillingPhone(event.target.value);
                }}
                placeholder="0712 345 678"
                required
              />
              <small>Taken from the number above. Change it to pay from another phone.</small>
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
              Delivery
              <b>
                {method !== "DELIVERY"
                  ? "KES 0"
                  : quotingDelivery
                    ? "Calculating…"
                    : !pin
                      ? "Pin your location"
                      : deliveryBlocked
                        ? "Unavailable"
                        : deliveryFee === 0
                          ? "FREE"
                          : `KES ${deliveryFee.toLocaleString()}`}
              </b>
            </span>
            {method === "DELIVERY" && deliveryQuote?.available ? (
              <span className="checkout-delivery-detail">
                {deliveryQuote.free
                  ? "Order qualifies for free delivery"
                  : `${deliveryQuote.distanceKm.toLocaleString()} km${deliveryQuote.bandLabel ? ` · ${deliveryQuote.bandLabel}` : ""}${deliveryQuote.branchName ? ` from ${deliveryQuote.branchName}` : ""}`}
                {!deliveryQuote.free && deliveryQuote.freeAboveSubtotal !== null
                  ? ` · Free above KES ${deliveryQuote.freeAboveSubtotal.toLocaleString()}`
                  : ""}
              </span>
            ) : null}
            <span>
              Total<strong>KES {total.toLocaleString()}</strong>
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
