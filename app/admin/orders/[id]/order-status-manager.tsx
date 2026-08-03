"use client";

import { FormEvent, useMemo, useState } from "react";

const statuses = ["NEW", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;
const steps = ["NEW", "CONFIRMED", "BEING_FULFILLED", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "COMPLETED"];
const packedStatuses = ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"];

type Order = { id: number; orderNumber: string; status: string; customerName: string; phone: string; email: string | null; fulfilmentMethod: string; paymentStatus: string; deliveryAddress: string | null; deliveryArea: string | null; total: string };
type Item = { id: number; productName: string; quantity: number; unitPrice: string; lineTotal: string };
type Store = { id: number; name: string };
type Fulfilment = { orderItemId: number; branchId: number; quantityReserved: number; quantityPacked: number; status: string };

export function OrderStatusManager({ order, items, stores = [], fulfilments = [] }: { order: Order; items: Item[]; stores?: Store[]; fulfilments?: Fulfilment[] }) {
  const [status, setStatus] = useState(order.status);
  const [saved, setSaved] = useState(order.status);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, number>>(() => Object.fromEntries(fulfilments.map((item) => [item.orderItemId, item.branchId])));
  const editable = !["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].includes(saved);
  const position = steps.indexOf(status);
  const fulfilmentPayload = useMemo(() => items.filter((item) => assignments[item.id]).map((item) => ({ orderItemId: item.id, branchId: assignments[item.id], quantityReserved: item.quantity, quantityPacked: packedStatuses.includes(status) ? item.quantity : 0, status: packedStatuses.includes(status) ? "READY" : "RESERVED" })), [items, assignments, status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, customerName: String(form.get("customerName")), phone: String(form.get("phone")), email: String(form.get("email")) || null, deliveryArea: String(form.get("deliveryArea")) || null, deliveryAddress: String(form.get("deliveryAddress")) || null, fulfilments: fulfilmentPayload }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) { setSaved(status); setMessage("Order and per-product branch assignments saved."); } else setMessage(data.error || "Order could not be updated.");
    setSaving(false);
  }

  return <main className="order-detail admin-order-detail"><header><a href="/admin/orders">← All orders</a><a href={`tel:${order.phone}`}>Call customer</a></header><section><span className="order-status">{status.replaceAll("_", " ")}</span><h1>{order.orderNumber}</h1><div className="order-progress">{steps.map((step, index) => <span className={index <= position ? "done" : ""} key={step}><i>{index < position ? "✓" : index + 1}</i><small>{step === "READY_FOR_DISPATCH" ? "PACKAGED" : step.replaceAll("_", " ")}</small></span>)}</div><form className="order-status-form order-edit-form" onSubmit={submit}><label>Order status<select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Customer<input name="customerName" defaultValue={order.customerName} disabled={!editable} /></label><label>Phone<input name="phone" defaultValue={order.phone} disabled={!editable} /></label><label>Email<input name="email" type="email" defaultValue={order.email || ""} disabled={!editable} /></label><label>Area<input name="deliveryArea" defaultValue={order.deliveryArea || ""} disabled={!editable} /></label><label className="full">Address<input name="deliveryAddress" defaultValue={order.deliveryAddress || ""} disabled={!editable} /></label><h2 className="full">Fulfil each product from a branch</h2>{items.map((item) => <label className="full" key={item.id}>{item.productName}<select value={assignments[item.id] || ""} onChange={(event) => setAssignments((current) => ({ ...current, [item.id]: Number(event.target.value) || 0 }))}><option value="">Choose branch</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name} · Qty {item.quantity}</option>)}</select></label>)}<button disabled={saving}>{saving ? "Saving…" : "Save order"}</button></form>{message ? <div className="form-message">{message}</div> : null}<h2>Order items</h2>{items.map((item) => <article key={item.id}><span><strong>{item.productName}</strong><small>Qty {item.quantity} × KES {Number(item.unitPrice).toLocaleString()}</small></span><b>KES {Number(item.lineTotal).toLocaleString()}</b></article>)}<footer><span>Total</span><strong>KES {Number(order.total).toLocaleString()}</strong></footer></section></main>;
}
