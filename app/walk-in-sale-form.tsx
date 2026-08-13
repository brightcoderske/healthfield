"use client";

import { CheckCircle2, Clipboard, LoaderCircle, Minus, Plus, RefreshCw, Smartphone, WalletCards } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Product = { id: number; name: string; sku: string; price: number; discountPrice: number | null };
type Branch = { id: number; name: string };
type Stock = { branchId: number; productId: number; available: number };
type PaymentOptions = { cashEnabled: boolean; mpesaEnabled: boolean; manualEnabled: boolean; smsEnabled: boolean; tillNumber: string | null; accountName: string | null };
type PaymentMethod = "CASH" | "MPESA_EXPRESS" | "MANUAL_MPESA";
type TillCandidate = { id:number; receiptNumber:string; amount:number; phone:string|null; payerName:string|null; accountReference:string|null; receivedAt:string };
type SaleState = { orderNumber: string; total: number; state: "WAITING" | "VERIFYING" | "CONFIRMING" | "CANCELLING" | "CANCELLED" | "FAILED" | "COMPLETE"; message: string; candidate?:TillCandidate|null };

export function WalkInSaleForm({ branches, products, stock, payment, backHref = "/staff" }: { branches: Branch[]; products: Product[]; stock: Stock[]; payment: PaymentOptions; backHref?: string }) {
  const router = useRouter();
  const firstMethod: PaymentMethod = payment.cashEnabled ? "CASH" : payment.mpesaEnabled ? "MPESA_EXPRESS" : "MANUAL_MPESA";
  const [branchId, setBranchId] = useState(branches[0]?.id || 0);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>(firstMethod);
  const [sale, setSale] = useState<SaleState | null>(null);
  const [copied, setCopied] = useState(false);
  const checkoutToken = useRef(crypto.randomUUID());
  const pollCount = useRef(0);

  const availability = useMemo(() => new Map(stock.filter((row) => row.branchId === branchId).map((row) => [row.productId, row.available])), [stock, branchId]);
  const availableFor = useCallback((productId: number) => availability.get(productId) || 0, [availability]);
  const rows = useMemo(() => products.filter((product) => cart[product.id]).map((product) => ({ ...product, quantity: cart[product.id], available: availableFor(product.id) })), [products, cart, availableFor]);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term) && availableFor(product.id) > 0).slice(0, 12);
  }, [products, query, availableFor]);
  const total = rows.reduce((sum, row) => sum + (row.discountPrice ?? row.price) * row.quantity, 0);
  const saleState = sale?.state;

  useEffect(() => {
    if (!saleState || !["WAITING", "CONFIRMING", "CANCELLING"].includes(saleState)) return;
    let cancelled = false;
    async function check() {
      pollCount.current += 1;
      const response = await fetch("/api/payments/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: checkoutToken.current }) }).catch(() => null);
      if (!response || cancelled) return;
      const data = await response.json().catch(() => ({}));
      if (data.paid || data.order?.paymentStatus === "PAID") {
        setSale((current) => current ? { ...current, state: "COMPLETE", message: `Payment confirmed. Receipt ${data.order?.paymentReference || "received"}.` } : current);
      } else if (data.cancelled || data.order?.status === "CANCELLED") {
        setSale((current) => current ? { ...current, state: "CANCELLED", message: data.message || "No payment was found during reconciliation. Reserved stock has been released." } : current);
      } else if (data.candidatePayment) {
        setSale((current) => current ? { ...current, state: "VERIFYING", candidate:data.candidatePayment, message: data.message || "Till payment found. Confirm the payer details with the customer." } : current);
      } else if (data.providerConfirmed || (data.payment?.status === "REQUIRES_REVIEW" && data.payment?.resultCode === "0")) {
        setSale((current) => current ? { ...current, state: "CONFIRMING", message: data.message || "Safaricom confirms payment. Waiting for the receipt before completing the sale." } : current);
      } else if (data.cancellationRequested || data.payment?.status === "CANCEL_REQUESTED") {
        setSale((current) => current ? { ...current, state: "CANCELLING", message: data.message || "Cancellation requested. Checking for a late M-Pesa confirmation before releasing stock." } : current);
      } else if (data.failed || data.order?.paymentStatus === "FAILED") {
        setSale((current) => current ? { ...current, state: "FAILED", message: data.message || data.payment?.resultDescription || "Payment was not completed." } : current);
      } else if (pollCount.current >= 24) {
        setSale((current) => current ? { ...current, message: "M-Pesa has not returned a final result yet. Healthfield is still checking; do not send a second payment." } : current);
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 4_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [saleState]);

  function setQuantity(id: number, value: number) {
    const available = availableFor(id);
    setCart((current) => {
      const next = { ...current };
      if (value > 0) next[id] = Math.min(available, value);
      else delete next[id];
      return next;
    });
  }

  function addProduct(product: Product) {
    setQuantity(product.id, (cart[product.id] || 0) + 1);
    setQuery("");
    setMessage(`${product.name} added. Search for another product or adjust its quantity in the sale summary.`);
  }

  async function copyTill() {
    if (!payment.tillNumber) return;
    try { await navigator.clipboard.writeText(payment.tillNumber); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); }
    catch { setMessage(`Till number: ${payment.tillNumber}`); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!rows.length) return setMessage("Add at least one product.");
    setSending(true); setMessage("");
    const response = await fetch("/api/walk-in-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, customerName, phone, email, checkoutToken: checkoutToken.current, paymentMethod: method, billingPhone: phone, items: rows.map((row) => ({ productId: row.id, quantity: row.quantity })) }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok && data.paid) {
      setSale({ orderNumber: data.orderNumber, total: Number(data.total), state: "COMPLETE", message: "Payment recorded and stock updated." });
    } else if (response?.ok) {
      pollCount.current = 0;
      setSale({ orderNumber: data.orderNumber, total: Number(data.total), state: data.paymentStatus === "FAILED" ? "FAILED" : "WAITING", message: data.message || "Waiting for payment confirmation." });
    } else setMessage(data?.error || "Sale could not be completed.");
    setSending(false);
  }

  async function retryPayment() {
    setSending(true); setMessage("");
    const response = await fetch("/api/payments/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: checkoutToken.current, billingPhone: phone }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(data?.error || "The payment prompt could not be sent.");
    else if (data.paymentStatus === "PAID" || data.order?.paymentStatus === "PAID") setSale((current) => current ? { ...current, state: "COMPLETE", message: "Payment confirmed and stock updated." } : current);
    else {
      checkoutToken.current = data.checkoutToken || checkoutToken.current;
      pollCount.current = 0;
      setSale((current) => current ? { ...current, state: "WAITING", message: data.message || "Approve the new payment prompt on the customer's phone." } : current);
    }
    setSending(false);
  }

  async function submitFallback(event: FormEvent) {
    event.preventDefault(); setSending(true); setMessage("");
    const response = await fetch("/api/payments/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: checkoutToken.current }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(data?.error || "Till payment could not be started.");
    else if (data.paid) setSale((current) => current ? { ...current, state: "COMPLETE", message: "Till payment confirmed and stock updated." } : current);
    else { pollCount.current = 0; setSale((current) => current ? { ...current, state: "WAITING", message: data.message } : current); }
    setSending(false);
  }

  async function cancelPending() {
    if (!confirm("Request cancellation? Healthfield will check M-Pesa once more and keep stock reserved briefly before closing the sale.")) return;
    setSending(true);
    const response = await fetch("/api/payments/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: checkoutToken.current }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok) { pollCount.current=0; setSale((current)=>current?{...current,state:"CANCELLING",message:data.message||"Cancellation requested. Reconciling M-Pesa before releasing stock."}:current); }
    else setMessage(data?.error || "Pending sale could not be cancelled.");
    setSending(false);
  }

  async function confirmTillPayment(){
    if(!sale?.candidate)return;
    setSending(true);setMessage("");
    const response=await fetch(`/api/payments/incoming/${sale.candidate.id}/confirm-pos`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutToken:checkoutToken.current})}).catch(()=>null);
    const data=await response?.json().catch(()=>({}));
    if(response?.ok)setSale((current)=>current?{...current,state:"COMPLETE",candidate:null,message:data.message||`Customer confirmed. Receipt ${data.receiptNumber} recorded.`}:current);
    else setMessage(data?.error||"The Till payment could not be confirmed.");
    setSending(false);
  }

  function resetSale(nextMessage = "") {
    setSale(null); setCart({}); setQuery(""); setCustomerName(""); setPhone(""); setEmail(""); setMessage(nextMessage);
    checkoutToken.current = crypto.randomUUID(); pollCount.current = 0; router.refresh();
  }

  const tillPanel = payment.manualEnabled ? <div className="pos-till-panel"><div><span>M-Pesa Till</span><strong>{payment.tillNumber}</strong><small>{payment.accountName || "Healthfield Pharmacy"} · KES {(sale?.total ?? total).toLocaleString()}</small></div><button type="button" onClick={copyTill}><Clipboard />{copied ? "Copied" : "Copy till"}</button><p>Pay the exact amount. This sale completes automatically when M-Pesa confirms the till receipt.</p><p className="pos-payment-reference"><b>Payment reference: {sale?.orderNumber || "Created after Start till payment"}</b><span>Use this Healthfield reference whenever M-Pesa provides an account/reference field.</span></p></div> : null;

  if (sale?.state === "COMPLETE") return <main className="walkin-sale pos-payment-complete"><header><Link href={backHref}>← Workspace</Link><div><span>Sale complete</span><h1>{sale.orderNumber}</h1></div></header><section><CheckCircle2 /><h2>Payment complete</h2><p>{sale.message}</p><strong>KES {sale.total.toLocaleString()}</strong><div className="pos-pack-reminder"><b>Before the customer leaves</b><p>Ensure you pack every product in the sale and give the complete order to the customer.</p></div>{email || (payment.smsEnabled && phone) ? <small>{email ? `Receipt email queued for ${email}.` : ""}{email && payment.smsEnabled && phone ? " " : ""}{payment.smsEnabled && phone ? `SMS confirmation queued for ${phone}.` : ""}</small> : null}<button type="button" onClick={() => resetSale()}>Continue sales</button></section></main>;

  if (sale) { const active=["WAITING","CONFIRMING","CANCELLING"].includes(sale.state); const heading=sale.state==="VERIFYING"?"Confirm customer payment details":sale.state==="CANCELLING"?"Reconciling before cancellation":sale.state==="CONFIRMING"?"Payment confirmed; receipt pending":sale.state==="CANCELLED"?"Sale cancelled safely":sale.state==="FAILED"?"Payment was not completed":"Waiting for M-Pesa confirmation"; return <main className="walkin-sale pos-payment-wait"><header><Link href={backHref}>← Workspace</Link><div><span>{active?"Payment in progress":sale.state==="CANCELLED"?"Sale closed":"Payment action required"}</span><h1>{sale.orderNumber}</h1></div></header><section>{active?<LoaderCircle className="spin"/>:<WalletCards/>}<h2>{heading}</h2><p>{sale.message}</p><strong>KES {sale.total.toLocaleString()}</strong><p className="pos-order-reference">Reference <b>{sale.orderNumber}</b></p>{sale.state==="VERIFYING"&&sale.candidate?<div className="pos-payer-confirmation"><span><small>M-Pesa name</small><strong>{sale.candidate.payerName||"Name not supplied by Safaricom"}</strong></span><span><small>Receipt code</small><strong>{sale.candidate.receiptNumber}</strong></span><span><small>Amount received</small><strong>KES {sale.candidate.amount.toLocaleString()}</strong></span><span><small>M-Pesa reference</small><strong>{sale.candidate.accountReference||"No reference"}</strong></span><p>Ask the customer to confirm the payer name and receipt code shown on their phone.</p><button type="button" disabled={sending} onClick={confirmTillPayment}>{sending?"Completing sale…":"Customer confirmed — complete sale"}</button></div>:null}{sale.state === "FAILED" && payment.mpesaEnabled ? <div className="pos-payment-retry"><label>Phone for the new prompt<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><button type="button" disabled={sending || phone.trim().length < 9} onClick={retryPayment}><RefreshCw />{sending ? "Sending…" : "Retry M-Pesa"}</button></div> : null}{sale.state === "FAILED" && payment.manualEnabled ? <form onSubmit={submitFallback}><h3>Or use till payment</h3>{tillPanel}<button disabled={sending}>{sending ? "Switching…" : "Switch to till payment"}</button></form> : null}{["WAITING","FAILED"].includes(sale.state)?<button className="cancel-pending-sale" type="button" disabled={sending} onClick={cancelPending}>Request cancellation</button>:null}{sale.state==="CANCELLED"?<button type="button" onClick={()=>resetSale("Previous unpaid sale cancelled and reserved stock released.")}>Start another sale</button>:null}{message ? <p className="form-message" role="alert">{message}</p> : null}</section></main> }

  return <main className="walkin-sale"><header><Link href={backHref}>← Workspace</Link><div><span>Point of sale</span><h1>Walk-in sale</h1><p>Choose cash, M-Pesa Express or automatic till payment. Stock is deducted only after payment completes.</p></div></header><form onSubmit={submit}><section><label>Branch<select value={branchId} onChange={(event) => { setBranchId(Number(event.target.value)); setCart({}); }} >{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><div className="walkin-customer"><label>Customer name<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Walk-in customer" /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Recommended for receipts and matching" required={method === "MPESA_EXPRESS"} /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Receipt email (optional)" /></label></div><h2>Add products</h2><label className="walkin-search">Search by product name or SKU<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type to search products" /></label><div className="walkin-products">{query.trim() ? matches.length ? matches.map((product) => { const available = availableFor(product.id), selected = cart[product.id] || 0; return <button type="button" key={product.id} onClick={() => addProduct(product)} disabled={selected >= available}><span><strong>{product.name}</strong><small>{product.sku} · {available} available</small></span><b>KES {Number(product.discountPrice ?? product.price).toLocaleString()}</b><em>{selected ? `Add another (${selected})` : "Add"}</em></button>; }) : <p className="walkin-hint">No in-stock products match that search.</p> : <p className="walkin-hint">Search, then select a product to add one automatically. Repeat for every product in the sale.</p>}</div>{message ? <p className="form-message" role="status">{message}</p> : null}</section><aside><h2>Sale summary</h2>{rows.length ? rows.map((row) => <div className="pos-sale-line" key={row.id}><span><strong>{row.name}</strong><small>KES {Number(row.discountPrice ?? row.price).toLocaleString()} each</small></span><span className="pos-quantity"><button type="button" aria-label={`Remove one ${row.name}`} onClick={() => setQuantity(row.id, row.quantity - 1)}><Minus /></button><input aria-label={`Quantity for ${row.name}`} type="number" min="1" max={row.available} value={row.quantity} onChange={(event) => setQuantity(row.id, Number(event.target.value) || 1)} /><button type="button" aria-label={`Add one ${row.name}`} disabled={row.quantity >= row.available} onClick={() => setQuantity(row.id, row.quantity + 1)}><Plus /></button></span><b>KES {((row.discountPrice ?? row.price) * row.quantity).toLocaleString()}</b></div>) : <p>No products selected.</p>}<footer><span>Total</span><strong>KES {total.toLocaleString()}</strong></footer><div className="pos-payment-methods">{payment.cashEnabled ? <label><input type="radio" checked={method === "CASH"} onChange={() => setMethod("CASH")} /><span>Cash</span></label> : null}{payment.mpesaEnabled ? <label><input type="radio" checked={method === "MPESA_EXPRESS"} onChange={() => setMethod("MPESA_EXPRESS")} /><span><Smartphone />M-Pesa push</span></label> : null}{payment.manualEnabled ? <label><input type="radio" checked={method === "MANUAL_MPESA"} onChange={() => setMethod("MANUAL_MPESA")} /><span>Pay to till</span></label> : null}</div>{method === "MANUAL_MPESA" ? tillPanel : null}<button disabled={sending || !rows.length}>{sending ? "Starting payment…" : method === "CASH" ? "Complete cash sale" : method === "MPESA_EXPRESS" ? "Send M-Pesa prompt" : "Start till payment"}</button></aside></form></main>;
}
