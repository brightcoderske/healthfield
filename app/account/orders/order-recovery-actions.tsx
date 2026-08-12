"use client";

import { CheckCircle2, LoaderCircle, RefreshCw, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type RecoveryItem = { productId: number | null; quantity: number };
type RecoveryState = "IDLE" | "WAITING" | "PAID" | "FAILED";

export function OrderRecoveryActions({ orderId, phone: initialPhone, items, mpesaEnabled }: { orderId: number; phone: string; items: RecoveryItem[]; mpesaEnabled: boolean }) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [state, setState] = useState<RecoveryState>("IDLE");
  const [message, setMessage] = useState("Choose how you want to recover this order.");
  const [busy, setBusy] = useState(false);
  const checkoutToken = useRef("");
  const pollCount = useRef(0);

  useEffect(() => {
    if (state !== "WAITING" || !checkoutToken.current) return;
    let cancelled = false;
    async function check() {
      pollCount.current += 1;
      const response = await fetch("/api/payments/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: checkoutToken.current }) }).catch(() => null);
      if (!response || cancelled) return;
      const data = await response.json().catch(() => ({}));
      if (data.paid || data.order?.paymentStatus === "PAID") {
        setState("PAID");
        setMessage(`Payment confirmed. Receipt ${data.order?.paymentReference || "received"}.`);
        router.refresh();
      } else if (data.failed || data.order?.paymentStatus === "FAILED") {
        setState("FAILED");
        setMessage(data.message || data.payment?.resultDescription || "The payment was not completed. You can retry again.");
      } else if (pollCount.current >= 24) {
        setState("FAILED");
        setMessage("Payment has not been confirmed. You can retry the prompt or rebuild the cart.");
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [router, state]);

  async function retryPayment() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/payments/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, billingPhone: phone }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setState("FAILED");
      setMessage(data?.error || "The payment prompt could not be sent.");
    } else if (data.paymentStatus === "PAID" || data.order?.paymentStatus === "PAID") {
      setState("PAID");
      setMessage("Payment confirmed. Your order is now being processed.");
      router.refresh();
    } else {
      checkoutToken.current = data.checkoutToken;
      pollCount.current = 0;
      setState("WAITING");
      setMessage(data.message || "Approve the payment prompt on your phone.");
    }
    setBusy(false);
  }

  async function restoreCart() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/cart", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      setMessage(data?.error || "These items could not be restored to your cart.");
      setBusy(false);
      return;
    }
    router.push("/cart");
  }

  return <section className="order-recovery" aria-live="polite">
    <div>{state === "WAITING" ? <LoaderCircle className="spin" /> : state === "PAID" ? <CheckCircle2 /> : <RefreshCw />}<span><strong>{state === "WAITING" ? "Waiting for payment" : state === "PAID" ? "Payment complete" : "Complete this order"}</strong><small>{message}</small></span></div>
    {mpesaEnabled && state !== "PAID" ? <label>Phone for the payment prompt<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label> : null}
    <footer>
      {mpesaEnabled && state !== "PAID" ? <button type="button" disabled={busy || state === "WAITING" || phone.trim().length < 9} onClick={retryPayment}><RefreshCw />{busy ? "Sending…" : "Retry M-Pesa"}</button> : null}
      {state !== "PAID" ? <button type="button" disabled={busy} onClick={restoreCart}><ShoppingCart /> Edit items in cart</button> : null}
    </footer>
  </section>;
}
