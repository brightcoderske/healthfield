"use client";

import { CheckCircle2, MapPin, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import styles from "./order-status-manager.module.css";

const statuses = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;
const steps = ["NEW", "CONFIRMED", "BEING_FULFILLED", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "COMPLETED"];
const packedStatuses = ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"];

type Order = { id: number; orderNumber: string; status: string; customerName: string; phone: string; email: string | null; fulfilmentMethod: string; paymentStatus: string; paymentMethod: string; paymentReference: string | null; amountPaid: string; deliveryAddress: string | null; deliveryArea: string | null; deliveryLatitude: string | null; deliveryLongitude: string | null; total: string };
type Item = { id: number; productId: number | null; productName: string; quantity: number; unitPrice: string; lineTotal: string };
type Store = { id: number; name: string };
type Fulfilment = { orderItemId: number; branchId: number; quantityReserved: number; quantityPacked: number; status: string };
type Stock = { productId: number; branchId: number; available: number };
type Payment = { id:number;method:"MPESA_EXPRESS"|"MANUAL_MPESA"|"CASH";channel:"ONLINE"|"POS";status:string;amount:string;phone:string|null;receiptNumber:string|null;manualMessage:string|null;resultDescription:string|null;createdAt:string };

const paymentLabel=(method:string)=>method==="MPESA_EXPRESS"?"M-Pesa Express":method==="MANUAL_MPESA"?"Manual M-Pesa":"Cash";

function automaticAssignments(items: Item[], fulfilments: Fulfilment[], stock: Stock[]) {
  return Object.fromEntries(items.map((item) => {
    const saved = fulfilments.find((entry) => entry.orderItemId === item.id)?.branchId;
    const available = item.productId === null ? undefined : stock.find((entry) => entry.productId === item.productId && entry.available >= item.quantity)?.branchId;
    return [item.id, saved ?? available ?? 0];
  }));
}

export function OrderStatusManager({ order, items, stores = [], fulfilments = [], stock = [], payments = [] }: { order: Order; items: Item[]; stores?: Store[]; fulfilments?: Fulfilment[]; stock?: Stock[]; payments?: Payment[] }) {
  const [status, setStatus] = useState(order.status);
  const [saved, setSaved] = useState(order.status);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState<Record<number, number>>(() => automaticAssignments(items, fulfilments, stock));
  const [reviewing,setReviewing]=useState<number|null>(null);
  const editable = !["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].includes(saved);
  const position = steps.indexOf(status);
  const mapUrl = order.deliveryLatitude && order.deliveryLongitude
    ? `https://www.google.com/maps?q=${encodeURIComponent(`${order.deliveryLatitude},${order.deliveryLongitude}`)}`
    : order.deliveryAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([order.deliveryAddress, order.deliveryArea].filter(Boolean).join(", "))}` : null;
  const fulfilmentPayload = useMemo(() => items.filter((item) => assignments[item.id]).map((item) => ({ orderItemId: item.id, branchId: assignments[item.id], quantityReserved: item.quantity, quantityPacked: packedStatuses.includes(status) ? item.quantity : 0, status: packedStatuses.includes(status) ? "READY" : "RESERVED" })), [items, assignments, status]);

  function availableAt(item: Item, storeId: number) {
    return item.productId === null ? null : stock.find((entry) => entry.productId === item.productId && entry.branchId === storeId)?.available ?? 0;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, customerName: String(form.get("customerName")), phone: String(form.get("phone")), email: String(form.get("email")) || null, deliveryArea: String(form.get("deliveryArea")) || null, deliveryAddress: String(form.get("deliveryAddress")) || null, fulfilments: fulfilmentPayload }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) { setSaved(status); setMessage("Order and serving-store assignments saved."); } else setMessage(data.error || "Order could not be updated.");
    setSaving(false);
  }

  async function reviewPayment(paymentId:number,decision:"APPROVE"|"REJECT"){
    if(decision==="REJECT"&&!confirm("Reject this payment proof? The order will remain unpaid."))return;
    setReviewing(paymentId);setMessage("");
    const response=await fetch(`/api/payments/${paymentId}/review`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision})}),data=await response.json().catch(()=>({}));
    if(response.ok)window.location.reload();else{setMessage(data.error||"Payment could not be reviewed.");setReviewing(null)}
  }

  return <main className="order-detail admin-order-detail">
    <header><Link href="/admin/orders">← All orders</Link><a href={`tel:${order.phone}`}>Call customer</a></header>
    <section>
      <span className="order-status">{status.replaceAll("_", " ")}</span><h1>{order.orderNumber}</h1>
      <div className="order-progress">{steps.map((step, index) => <span className={index <= position ? "done" : ""} key={step}><i>{index < position ? "✓" : index + 1}</i><small>{step === "READY_FOR_DISPATCH" ? "PACKAGED" : step.replaceAll("_", " ")}</small></span>)}</div>
      <form className="order-status-form order-edit-form" onSubmit={submit}>
        <label>Order status<select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Customer<input name="customerName" defaultValue={order.customerName} disabled={!editable} /></label><label>Phone<input name="phone" defaultValue={order.phone} disabled={!editable} /></label>
        <label>Email<input name="email" type="email" defaultValue={order.email || ""} disabled={!editable} /></label><label>Area<input name="deliveryArea" defaultValue={order.deliveryArea || ""} disabled={!editable} /></label>
        <label className="full">Address<input name="deliveryAddress" defaultValue={order.deliveryAddress || ""} disabled={!editable} /></label>
        {mapUrl && <a className={styles.mapLink} href={mapUrl} target="_blank" rel="noreferrer"><MapPin /> View exact delivery location</a>}
        <aside className={styles.paymentSummary} aria-label="Payment details"><span><small>Payment method</small><strong className={`payment-type payment-type-${order.paymentMethod.toLowerCase()}`}>{paymentLabel(order.paymentMethod)}</strong></span><span><small>Amount paid</small><strong>KES {Number(order.amountPaid).toLocaleString()}</strong></span><span><small>{order.paymentMethod === "CASH" ? "Payment status" : "M-Pesa code"}</small><strong>{order.paymentMethod === "CASH" ? order.paymentStatus : order.paymentReference || "Awaiting confirmation"}</strong></span></aside>
        <section className="payment-audit"><header><span><ShieldCheck/><strong>Payment verification</strong></span><em className={`payment-status payment-status-${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus}</em></header>{payments.length?payments.map(payment=><article key={payment.id}><div><span className={`payment-type payment-type-${payment.method.toLowerCase()}`}>{paymentLabel(payment.method)}</span><strong>KES {Number(payment.amount).toLocaleString()}</strong><small>{new Date(payment.createdAt).toLocaleString()}</small></div><div><small>Receipt</small><strong>{payment.receiptNumber||"Not received"}</strong><small>{payment.phone||"No billing phone"}</small></div><div><small>Status</small><strong>{payment.status.replaceAll("_"," ")}</strong><small>{payment.resultDescription||"No provider message"}</small></div>{payment.manualMessage?<details><summary>View submitted payment message</summary><p>{payment.manualMessage}</p></details>:<span/>}{payment.status==="REQUIRES_REVIEW"?<div className="payment-review-actions"><button type="button" disabled={reviewing===payment.id} onClick={()=>reviewPayment(payment.id,"APPROVE")}><CheckCircle2/>Approve</button><button type="button" disabled={reviewing===payment.id} onClick={()=>reviewPayment(payment.id,"REJECT")}><XCircle/>Reject</button></div>:null}</article>):<p>No payment attempts recorded.</p>}</section>
        <h2 className={styles.itemsTitle}>Order items</h2><div className={styles.items}><div className={styles.head}><span>Product</span><span>Quantity</span><span>Amount</span><span>Serving store</span></div>{items.map((item) => <div className={styles.row} key={item.id}><strong>{item.productName}</strong><span>{item.quantity}</span><span>KES {Number(item.lineTotal).toLocaleString()}</span><label><select aria-label={`Serving store for ${item.productName}`} value={assignments[item.id] || ""} disabled={!editable} onChange={(event) => setAssignments((current) => ({ ...current, [item.id]: Number(event.target.value) || 0 }))}><option value="">No store with enough stock</option>{stores.map((store) => { const available = availableAt(item, store.id); return <option value={store.id} key={store.id} disabled={available !== null && available < item.quantity}>{store.name}{available === null ? "" : ` (${available} available)`}</option>; })}</select></label></div>)}</div>
        <div className={styles.actions}><button disabled={saving}>{saving ? "Saving…" : "Save order"}</button></div>
      </form>
      {message ? <div className="form-message">{message}</div> : null}<footer><span>Total</span><strong>KES {Number(order.total).toLocaleString()}</strong></footer>
    </section>
  </main>;
}
