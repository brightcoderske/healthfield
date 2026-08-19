"use client";

import { AlertTriangle, CheckCircle2, PlugZap, RefreshCw, Search, WalletCards } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type OrderCandidate = { orderId: number; orderNumber: string; customerName: string; phone: string; total: string; orderStatus: string; paymentStatus: string };
type Suggestion = OrderCandidate | null;
export type UnmatchedPayment = { id: number; receiptNumber: string; amount: string; phone: string | null; payerName: string | null; accountReference: string | null; transactionTime: string | null; createdAt: string; suggestion: Suggestion; candidates: OrderCandidate[]; sameAmountReceiptCount: number };
export type PaymentException = { paymentId: number; orderId: number; orderNumber: string; customerName: string; amount: string; phone: string | null; method: string; status: string; resultCode: string | null; resultDescription: string | null; createdAt: string };

export type TillDelivery = {
  mpesaConfigured: boolean;
  shortcode: string | null;
  confirmationUrl: string | null;
  validationUrl: string | null;
  registeredAt: string | null;
  registrationResponse: string | null;
  pullConfigured: boolean;
  pullEnabled?: boolean;
  pullNumberDigits?: number;
  pullNumberValid?: boolean;
  transactionStatusConfigured: boolean;
};

/** Names the half that is wrong, rather than restating the whole setup. */
function pullReason(till: TillDelivery) {
  if (till.pullConfigured) return "Enabled — Fetch missed Till payments can query Safaricom for the last 24 hours.";
  if (till.pullEnabled === false) return "MPESA_PULL_ENABLED is not “true” in the environment the API actually started with. A value set in cPanel’s Node.js app table overrides api-service/.env, because loadEnvFile never replaces a variable that already exists.";
  if (till.pullNumberValid === false) return `MPESA_PULL_NOMINATED_NUMBER must be 12 digits — 254, then 7 or 1, then eight more. The API sees ${till.pullNumberDigits ?? 0}.`;
  return "Off. Set MPESA_PULL_ENABLED=true and MPESA_PULL_NOMINATED_NUMBER in the API environment, then register the pull callback.";
}

export function UnmatchedPaymentsManager({ initialPayments, exceptions, till }: { initialPayments: UnmatchedPayment[]; exceptions: PaymentException[]; till?: TillDelivery }) {
  const [payments, setPayments] = useState(initialPayments);
  const [query, setQuery] = useState("");
  const [references, setReferences] = useState<Record<number, string>>(() => Object.fromEntries(initialPayments.map((payment) => [payment.id, payment.suggestion?.orderNumber || payment.accountReference || ""])));
  const [working, setWorking] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [notice, setNotice] = useState("");
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? payments.filter((payment) => `${payment.receiptNumber} ${payment.phone || ""} ${payment.accountReference || ""} ${payment.amount} ${payment.candidates.map((candidate) => `${candidate.orderNumber} ${candidate.customerName}`).join(" ")}`.toLowerCase().includes(term)) : payments;
  }, [payments, query]);

  async function match(payment: UnmatchedPayment) {
    const orderReference = (references[payment.id] || "").trim().toUpperCase();
    if (!orderReference) return setNotice("Enter the exact Healthfield order reference first.");
    setWorking(payment.id);
    setNotice("");
    const response = await fetch(`/api/payments/incoming/${payment.id}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderReference }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok) {
      setPayments((rows) => rows.filter((row) => row.id !== payment.id));
      setNotice(data.message || `${payment.receiptNumber} matched to ${orderReference}.`);
    } else setNotice(data?.error || "The payment could not be matched.");
    setWorking(null);
  }

  const [registering, setRegistering] = useState(false);
  const [registeredAt, setRegisteredAt] = useState(till?.registeredAt ?? null);

  // Registration is what makes Safaricom post a Till payment here at all. It is not
  // part of a deploy: it has to be redone whenever the callback host, the callback
  // secret or the Daraja app changes, and until it is done the only way a payment
  // reaches the portal is somebody pasting the customer's SMS.
  async function registerTillCallbacks() {
    setRegistering(true);
    setNotice("");
    const response = await fetch("/api/payments/c2b/register", { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setNotice(data?.message || data?.error || "Safaricom could not be reached to register the Till callbacks.");
    if (response?.ok) setRegisteredAt(new Date().toISOString());
    setRegistering(false);
  }

  async function recoverMissedPayments() {
    setRecovering(true);
    setNotice("");
    const response = await fetch("/api/payments/recovery", { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setNotice(data?.message || data?.error || "The Till recovery check could not be started.");
    setRecovering(false);
    if (response?.ok && !data?.throttled) window.setTimeout(() => window.location.reload(), 2500);
  }

  return <main className="compact-admin-page unmatched-payments-page">
    <header><div><Link href="/admin">← Dashboard</Link><h1>Unmatched M-Pesa payments</h1><p>Resolve Till receipts that Safaricom delivered but could not be attached safely to one order.</p></div><span className="unmatched-total"><WalletCards/><b>{payments.length}</b> awaiting match</span></header>
    <div className="compact-table-tools"><label><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipt, phone, reference or amount"/></label><button className="pull-recovery-button" type="button" disabled={recovering} onClick={recoverMissedPayments}><RefreshCw className={recovering ? "spin" : undefined}/>{recovering ? "Checking Safaricom…" : "Fetch missed Till payments"}</button><span>{shown.length} payments</span></div>
    {notice ? <p className="form-message unmatched-notice" role="status">{notice}</p> : null}
    {till ? <section className="till-delivery"><header><PlugZap/><div><h2>Till payment delivery</h2><p>How a Safaricom payment reaches this portal without anyone pasting an SMS.</p></div></header>
      <ul>
        <li className={till.mpesaConfigured ? "ok" : "off"}><b>Daraja credentials</b><span>{till.mpesaConfigured ? `Configured for shortcode ${till.shortcode}` : "Missing — the API has no M-Pesa credentials, so nothing can be delivered or queried."}</span></li>
        <li className={registeredAt ? "ok" : "off"}><b>Till callbacks registered</b><span>{registeredAt ? `Registered ${new Date(registeredAt).toLocaleString("en-KE")}${till.registrationResponse ? ` · ${till.registrationResponse}` : ""}` : "Never registered from this portal. Safaricom only posts to URLs registered against the shortcode, so payments arrive nowhere until this is done."}</span>{till.confirmationUrl ? <small>{till.confirmationUrl}</small> : null}</li>
        <li className={till.pullConfigured ? "ok" : "off"}><b>Pull Transactions (missed payment recovery)</b><span>{pullReason(till)}</span>{till.pullConfigured && till.pullNumberValid === false ? <small>No nominated number, so the pull callback cannot be registered yet.</small> : null}</li>
        <li className={till.transactionStatusConfigured ? "ok" : "off"}><b>Transaction Status lookups</b><span>{till.transactionStatusConfigured ? "Enabled — a pasted receipt can be verified with Safaricom directly." : "Off. Set MPESA_INITIATOR_NAME and MPESA_SECURITY_CREDENTIAL to verify receipts without waiting for a callback."}</span></li>
      </ul>
      <button type="button" className="pull-recovery-button" disabled={registering || !till.mpesaConfigured} onClick={registerTillCallbacks}><PlugZap/>{registering ? "Registering with Safaricom…" : registeredAt ? "Register Till callbacks again" : "Register Till callbacks with Safaricom"}</button>
    </section> : null}
    {shown.length ? <div className="unmatched-table-scroller"><table className="unmatched-payments-table"><thead><tr><th>Receipt</th><th>Payer</th><th>Phone</th><th>M-Pesa reference</th><th>Received</th><th>Amount</th><th>Order match</th></tr></thead><tbody>{shown.map((payment) => <tr key={payment.id}>
      <td><strong>{payment.receiptNumber}</strong></td><td>{payment.payerName || "Not supplied"}</td><td>{payment.phone || "Not supplied"}</td><td>{payment.accountReference || "No reference"}</td><td>{new Date(payment.createdAt).toLocaleString("en-KE")}</td><td className="payment-amount">KES {Number(payment.amount).toLocaleString()}</td>
      <td className="unmatched-order-match">
        {payment.suggestion ? <p className="payment-suggestion"><CheckCircle2/><span>Likely: <Link href={`/admin/orders/${payment.suggestion.orderId}`}>{payment.suggestion.orderNumber}</Link> · {payment.suggestion.customerName}</span></p> : payment.candidates.length ? <p className="payment-suggestion uncertain"><AlertTriangle/><span>{payment.sameAmountReceiptCount > 1 ? `${payment.sameAmountReceiptCount} unmatched receipts have this amount — verify the receipt` : `${payment.candidates.length} orders have this amount — choose the correct one`}</span></p> : null}
        <div><label><span className={!payment.candidates.length ? "unmatched-inline-note" : undefined}>{payment.candidates.length ? "Choose matching Healthfield order" : "No safe automatic match"}</span>{payment.candidates.length ? <select value={references[payment.id] || ""} onChange={(event) => setReferences((current) => ({ ...current, [payment.id]: event.target.value }))}><option value="">Choose order</option>{payment.candidates.map((candidate) => <option key={candidate.orderId} value={candidate.orderNumber}>{candidate.orderNumber} · {candidate.customerName}</option>)}</select> : <input aria-label="Healthfield order reference" value={references[payment.id] || ""} onChange={(event) => setReferences((current) => ({ ...current, [payment.id]: event.target.value }))} placeholder="POS-… or HF-…"/>}</label><button type="button" disabled={working === payment.id || !(references[payment.id] || "").trim()} onClick={() => match(payment)}>{working === payment.id ? "Matching…" : "Match"}</button></div>
      </td>
    </tr>)}</tbody></table></div> : null}
    {!shown.length ? <div className="database-empty"><CheckCircle2/><strong>{payments.length ? "No matching receipts" : "All Till payments are matched"}</strong><span>{payments.length ? "Try another search." : "New unmatched Safaricom confirmations will appear here automatically."}</span></div> : null}
    <section className="payment-exceptions"><header><h2>Payment exceptions</h2><p>Provider-confirmed payments awaiting a receipt and cancellations still inside their reconciliation window.</p></header>{exceptions.length ? <div className="payment-exceptions-scroller"><table><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Amount</th><th>Phone</th><th>Status</th><th>Provider update</th><th>Action</th></tr></thead><tbody>{exceptions.map((item) => <tr key={item.paymentId}><td><strong>{item.orderNumber}</strong></td><td>{item.customerName}</td><td>{item.method.replaceAll("_", " ")}</td><td className="payment-amount">KES {Number(item.amount).toLocaleString()}</td><td>{item.phone || "No phone"}</td><td><b>{item.status.replaceAll("_", " ")}</b></td><td>{item.resultDescription || "Awaiting provider update"}</td><td><Link href={`/admin/orders/${item.orderId}`}>Open order</Link></td></tr>)}</tbody></table></div> : <div className="database-empty"><CheckCircle2/><strong>No payment exceptions</strong><span>There are no provider-confirmed receipt gaps or cancellation reconciliations.</span></div>}</section>
  </main>;
}
