"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConfirmReceivedButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function confirmReceived() {
    if (!window.confirm("Confirm that this order has been delivered to you?")) return;
    setWorking(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/received`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok) {
      setMessage(data.message || "Thank you. This order is now complete.");
      router.refresh();
    } else {
      setMessage(data?.error || "Delivery confirmation could not be saved.");
      setWorking(false);
    }
  }

  return <section className="customer-received-action" aria-label="Confirm delivery">
    <CheckCircle2/>
    <div><strong>Have you received this delivery?</strong><p>Confirm only after the order is in your hands. Healthfield will be notified immediately.</p></div>
    <button type="button" disabled={working} onClick={confirmReceived}>{working ? "Confirming…" : "Mark as received"}</button>
    {message ? <p className="form-message" role="status">{message}</p> : null}
  </section>;
}
