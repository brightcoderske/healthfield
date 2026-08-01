"use client";

import { FormEvent, useState } from "react";

const statuses = [
  "NEW", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY",
  "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED",
] as const;

type Order = {
  id: number;
  orderNumber: string;
  status: string;
  customerName: string;
  phone: string;
  email: string | null;
  fulfilmentMethod: string;
  paymentStatus: string;
  deliveryAddress: string | null;
  deliveryArea: string | null;
  total: string;
};

type Item = { id: number; productName: string; quantity: number; unitPrice: string; lineTotal: string };

export function OrderStatusManager({ order, items }: { order: Order; items: Item[] }) {
  const [status, setStatus] = useState(order.status);
  const [savedStatus, setSavedStatus] = useState(order.status);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setSavedStatus(status);
      setMessage("Order status updated. Customer notified by email when available.");
    } else {
      setMessage(data.error || "Status could not be updated.");
    }
    setSaving(false);
  }

  return (
    <main className="order-detail admin-order-detail">
      <header>
        <a href="/admin/orders">← All orders</a>
        <a href={`tel:${order.phone}`}>Call customer</a>
      </header>
      <section>
        <span className="order-status">{status.replaceAll("_", " ")}</span>
        <h1>{order.orderNumber}</h1>
        <p>{order.customerName} · {order.phone} · {order.email || "No email"}</p>
        <div className="order-meta">
          <span><small>Fulfilment</small><strong>{order.fulfilmentMethod}</strong></span>
          <span><small>Payment</small><strong>{order.paymentStatus}</strong></span>
          <span><small>Address / area</small><strong>{order.deliveryAddress || order.deliveryArea || "Store pickup"}</strong></span>
        </div>
        <form className="order-status-form" onSubmit={submit}>
          <label>
            Order status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <button disabled={saving || status === savedStatus}>{saving ? "Saving…" : "Update status"}</button>
        </form>
        {message && <div className="form-message">{message}</div>}
        <h2>Order items</h2>
        {items.map((item) => (
          <article key={item.id}>
            <span>
              <strong>{item.productName}</strong>
              <small>Qty {item.quantity} × KES {Number(item.unitPrice).toLocaleString()}</small>
            </span>
            <b>KES {Number(item.lineTotal).toLocaleString()}</b>
          </article>
        ))}
        <footer>
          <span>Total</span>
          <strong>KES {Number(order.total).toLocaleString()}</strong>
        </footer>
      </section>
    </main>
  );
}
