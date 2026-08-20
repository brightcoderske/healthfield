"use client";

import {
  Banknote, BarChart3, Camera, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  ClipboardList, CreditCard, FileText, HandCoins, LoaderCircle, Minus, PackagePlus, Pause,
  Percent, Plus, Printer, ReceiptText, RotateCcw, Search, ShoppingCart, Smartphone, Trash2, UserRound,
  WalletCards, X,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCheckoutToken } from "@/lib/checkout-token";
import { cashChange, nairobiDateTime, saleTotal, splitPaymentBalances } from "@/lib/pos";
import { manualTillPollDelay, paymentPollDelay } from "@/lib/payment-poll";
import { parseVatRate, vatOnNet, vatRateLabel } from "@/lib/vat";
import type { HeldSale, PosProduct, PosReport, PosWorkspaceData } from "./types";
import styles from "./pos.module.css";

type Mode = "CASH" | "MPESA_EXPRESS" | "MANUAL_MPESA" | "SPLIT";
type Panel = "held" | "stock" | "expense" | "close" | "reports" | null;
type CheckoutStep = "METHOD" | "DETAILS" | null;
type TillCandidate = { id: number; receiptNumber: string; amount: number; phone: string | null; payerName: string | null; accountReference: string | null; receivedAt: string };
type Sale = { id: number; orderNumber: string; total: number; checkoutToken: string; state: "WAITING" | "VERIFYING" | "REVIEWING" | "FAILED" | "CANCELLING" | "CANCELLED" | "COMPLETE"; message: string; candidate?: TillCandidate | null; candidates?: TillCandidate[]; receiptNumber?: string | null };

const money = (value: number) => `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** type="number" still accepts e, E, + and - in most browsers; a till amount never contains them. */
const digitsOnly = (event: ReactKeyboardEvent<HTMLInputElement>) => { if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault(); };

/** Exact amount first, then the notes a customer is most likely to hand over. */
function tenderOptions(due: number) {
  const amount = Math.round(due * 100) / 100;
  if (!(amount > 0)) return [];
  return [amount, ...[50, 100, 200, 500, 1000, 2000, 5000].filter((note) => note > amount).slice(0, 3)];
}

export function PosWorkspace({ data, backHref }: { data: PosWorkspaceData; backHref: string }) {
  const router = useRouter();
  const [clock, setClock] = useState(() => new Date());
  const [existingSessionAction, setExistingSessionAction] = useState<"ASK" | "CONTINUE" | "CLOSE">("ASK");
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  if (!data.activeSession) return <OpenSession data={data} backHref={backHref} onOpened={() => { setExistingSessionAction("CONTINUE"); router.refresh(); }} />;
  if (existingSessionAction === "ASK") return <ExistingSessionPrompt data={data} backHref={backHref} onContinue={() => setExistingSessionAction("CONTINUE")} onClose={() => setExistingSessionAction("CLOSE")}/>;
  return <ActivePos key={data.activeSession.id} data={data} backHref={backHref} clock={clock} initialPanel={existingSessionAction === "CLOSE" ? "close" : null} />;
}

function ExistingSessionPrompt({ data, backHref, onContinue, onClose }: { data: PosWorkspaceData; backHref: string; onContinue: () => void; onClose: () => void }) {
  const session = data.activeSession!;
  return <main className={styles.openPage}><section className={styles.openCard}>
    <Link href={backHref} className={styles.back}><ChevronLeft/> Back to workspace</Link>
    <div className={styles.openIcon}><ClipboardList/></div>
    <span className={styles.eyebrow}>Open session found</span>
    <h1>Continue this cashier session?</h1>
    <p>This session was not closed. Review it before adding new sales so transactions stay attached to the correct drawer and till.</p>
    <div className={styles.existingSessionDetails}>
      <p><span>Session</span><b>{session.sessionNumber}</b></p><p><span>Branch</span><b>{session.branchName}</b></p>
      <p><span>Till</span><b>{session.tillName}</b></p><p><span>Opened</span><b>{nairobiDateTime(session.openedAt)}</b></p>
      <p><span>Opening cash</span><b>{money(session.openingCash)}</b></p><p><span>Sales so far</span><b>{money(data.totals?.sales || 0)}</b></p>
    </div>
    <div className={styles.sessionDecision}><button onClick={onContinue}><CheckCircle2/> Continue session</button><button onClick={onClose}><WalletCards/> Review and close</button></div>
  </section></main>;
}

function OpenSession({ data, backHref, onOpened }: { data: PosWorkspaceData; backHref: string; onOpened: () => void }) {
  const [branchId, setBranchId] = useState(data.branches[0]?.id || 0);
  const tills = data.tills.filter((till) => till.branchId === branchId);
  const [tillId, setTillId] = useState(tills[0]?.id || 0);
  const [openingFloat, setOpeningFloat] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setTillId(data.tills.find((till) => till.branchId === branchId)?.id || 0); }, [branchId, data.tills]);
  async function open(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const response = await fetch("/api/pos/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, tillId, openingFloat, openingCash }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(body?.error || "The POS session could not be opened.");
    else onOpened();
    setSaving(false);
  }
  return <main className={styles.openPage}>
    <section className={styles.openCard}>
      <Link href={backHref} className={styles.back}><ChevronLeft/> Back to workspace</Link>
      <div className={styles.openIcon}><WalletCards/></div>
      <span className={styles.eyebrow}>Healthfield point of sale</span>
      <h1>Open your cashier session</h1>
      <p>Every sale, payment, stock receipt and expense will be attached to you until you close this session.</p>
      <form onSubmit={open}>
        <label>Branch<select value={branchId} onChange={(event) => setBranchId(Number(event.target.value))}>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>Till<select value={tillId} onChange={(event) => setTillId(Number(event.target.value))} required>{tills.map((till) => <option key={till.id} value={till.id}>{till.name}</option>)}</select></label>
        <label>Opening float<input type="number" min="0" step=".01" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} placeholder="0.00" required/><small>Change set aside for customers.</small></label>
        <label>Opening cash counted<input type="number" min="0" step=".01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="0.00" required/><small>All cash physically in the drawer now.</small></label>
        {message ? <p className={styles.error}>{message}</p> : null}
        <button disabled={saving || !branchId || !tillId}>{saving ? <LoaderCircle className={styles.spin}/> : <CheckCircle2/>}{saving ? "Opening…" : "Open session"}</button>
      </form>
      <small className={styles.kenyaTime}>Kenya time: {nairobiDateTime(new Date())}</small>
    </section>
  </main>;
}

function ActivePos({ data, backHref, clock, initialPanel = null }: { data: PosWorkspaceData; backHref: string; clock: Date; initialPanel?: Panel }) {
  const session = data.activeSession!;
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const checkoutToken = useRef(createCheckoutToken());
  const pollCount = useRef(0);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [discount, setDiscount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<Mode>(data.payment.cashEnabled ? "CASH" : data.payment.mpesaEnabled ? "MPESA_EXPRESS" : "MANUAL_MPESA");
  const [splitCash, setSplitCash] = useState("");
  const [splitOther, setSplitOther] = useState("");
  const [splitMethod, setSplitMethod] = useState<"MPESA_EXPRESS" | "MANUAL_MPESA">(data.payment.mpesaEnabled ? "MPESA_EXPRESS" : "MANUAL_MPESA");
  const [cashReceived, setCashReceived] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [sale, setSale] = useState<Sale | null>(null);
  const [heldSaleId, setHeldSaleId] = useState<number | undefined>();
  const [manualProof, setManualProof] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [autoPrint, setAutoPrint] = useState(false);
  const [showVat, setShowVat] = useState(false);
  const salePanelRef = useRef<HTMLElement>(null);
  const focusSearch = useCallback(() => { if (window.matchMedia?.("(pointer: coarse)").matches) return; searchRef.current?.focus(); }, []);
  const [checkout, setCheckout] = useState<CheckoutStep>(null);

  useEffect(() => { setAutoPrint(window.localStorage.getItem("healthfield:pos:auto-print") === "true"); }, []);
  useEffect(() => { focusSearch(); }, [focusSearch]);

  const availability = useMemo(() => new Map(data.stock.filter((row) => row.branchId === session.branchId).map((row) => [row.productId, row.available])), [data.stock, session.branchId]);
  const rows = useMemo(() => data.products.filter((product) => cart[product.id]).map((product) => ({ ...product, quantity: cart[product.id], available: availability.get(product.id) || 0 })), [data.products, cart, availability]);
  const subtotal = rows.reduce((sum, row) => sum + (row.discountPrice ?? row.price) * row.quantity, 0);
  const net = saleTotal(subtotal, Number(discount) || 0);
  const vatRate = parseVatRate(data.vat?.rate);
  const vatAmount = showVat && vatRate ? vatOnNet(net, vatRate) : null;
  const total = Math.round((net + (vatAmount ?? 0)) * 100) / 100;
  const change = cashChange(mode === "SPLIT" ? Number(splitCash) || 0 : total, Number(cashReceived) || 0);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return data.products.filter((product) => (availability.get(product.id) || 0) > 0 && (!term || `${product.name} ${product.sku} ${product.barcode || ""} ${product.brand || ""}`.toLowerCase().includes(term)));
  }, [data.products, availability, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const products = filtered.slice((Math.min(page, pages) - 1) * 12, Math.min(page, pages) * 12);
  const cartCount = rows.reduce((sum, row) => sum + row.quantity, 0);
  const cashLeg = mode === "CASH" || mode === "SPLIT";
  const mpesaLeg = mode === "MPESA_EXPRESS" || (mode === "SPLIT" && splitMethod === "MPESA_EXPRESS");
  const tillLeg = mode === "MANUAL_MPESA" || (mode === "SPLIT" && splitMethod === "MANUAL_MPESA");
  const cashPortion = mode === "SPLIT" ? Math.max(0, Number(splitCash) || 0) : total;
  const otherSide = (value: string) => value === "" ? "" : (Math.round(Math.max(0, total - (Number(value) || 0)) * 100) / 100).toFixed(2);
  function editSplitCash(value: string) { setSplitCash(value); setSplitOther(otherSide(value)); }
  function editSplitOther(value: string) { setSplitOther(value); setSplitCash(otherSide(value)); }
  const tenders = tenderOptions(cashPortion);
  const customerSummary = [customerName.trim(), phone.trim()].filter(Boolean).join(" · ");

  const setQuantity = useCallback((id: number, value: number) => {
    const available = availability.get(id) || 0;
    setCart((current) => { const next = { ...current }; if (value > 0) next[id] = Math.min(available, value); else delete next[id]; return next; });
  }, [availability]);
  const addProduct = useCallback((product: PosProduct) => {
    setQuantity(product.id, (cart[product.id] || 0) + 1); setQuery(""); setPage(1); setMessage(`${product.name} added.`); window.setTimeout(focusSearch, 0);
  }, [cart, setQuantity, focusSearch]);
  const scanValue = useCallback((value: string) => {
    const code = value.trim().toLowerCase();
    const product = data.products.find((item) => item.barcode?.toLowerCase() === code || item.sku.toLowerCase() === code);
    if (!product) return setMessage(`No product matches barcode ${value}.`);
    if ((availability.get(product.id) || 0) <= 0) return setMessage(`${product.name} has no available stock in ${session.branchName}.`);
    addProduct(product);
  }, [data.products, availability, session.branchName, addProduct]);
  const handleCameraCode = useCallback((code: string) => { setCameraOpen(false); scanValue(code); }, [scanValue]);

  useEffect(() => {
    if (cameraOpen || panel || checkout || sale) return;
    let buffer = ""; let timer = 0;
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Enter" && buffer.length >= 3) { scanValue(buffer); buffer = ""; window.clearTimeout(timer); return; }
      if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
      buffer += event.key; window.clearTimeout(timer); timer = window.setTimeout(() => { buffer = ""; }, 120);
    }
    window.addEventListener("keydown", key); return () => { window.removeEventListener("keydown", key); window.clearTimeout(timer); };
  }, [scanValue, cameraOpen, panel, checkout, sale]);

  useEffect(() => {
    if (!sale || !["WAITING", "REVIEWING", "CANCELLING"].includes(sale.state)) return;
    let cancelled = false; let timer = 0;
    async function check() {
      pollCount.current += 1;
      const response = await fetch("/api/payments/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: sale!.checkoutToken }) }).catch(() => null);
      if (!response || cancelled) return;
      const body = await response.json().catch(() => ({}));
      if (body.paid || body.order?.paymentStatus === "PAID") setSale((current) => current ? { ...current, state: "COMPLETE", receiptNumber: body.order?.paymentReference, message: "Payment confirmed, stock updated and receipt created." } : current);
      else if (body.cancelled) setSale((current) => current ? { ...current, state: "CANCELLED", message: body.message || "The sale was cancelled and reserved stock was released." } : current);
      else if (body.candidatePayment) setSale((current) => current ? { ...current, state: "VERIFYING", candidate: body.candidatePayment, candidates: undefined, message: body.message } : current);
      else if (Array.isArray(body.candidatePayments) && body.candidatePayments.length) setSale((current) => current ? { ...current, state: "VERIFYING", candidate: null, candidates: body.candidatePayments, message: body.message } : current);
      else if (body.failed || body.order?.paymentStatus === "FAILED") setSale((current) => current ? { ...current, state: "FAILED", message: body.message || body.payment?.resultDescription || "Payment was not completed." } : current);
      else setSale((current) => current ? { ...current, message: body.message || "Waiting for payment confirmation." } : current);
    }
    function schedule() { if (cancelled) return; timer = window.setTimeout(() => void check().finally(schedule), mode === "MANUAL_MPESA" || splitMethod === "MANUAL_MPESA" ? manualTillPollDelay(pollCount.current) : paymentPollDelay(pollCount.current)); }
    void check().finally(schedule); return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sale?.state, sale?.checkoutToken, mode, splitMethod]);

  function resetSale() {
    setCart({}); setDiscount(""); setCustomerName(""); setPhone(""); setEmail(""); setCashReceived(""); setSplitCash(""); setSplitOther(""); setSale(null); setHeldSaleId(undefined); setManualProof(""); setMessage(""); setCheckout(null); setShowVat(false); checkoutToken.current = createCheckoutToken(); pollCount.current = 0; router.refresh(); window.setTimeout(focusSearch, 0);
  }
  function openCheckout() {
    if (!rows.length) return setMessage("Add at least one product before charging.");
    setMessage(""); setCheckout("METHOD");
  }
  function chooseMode(next: Mode) { setMode(next); setMessage(""); setCheckout("DETAILS"); }
  async function submitSale() {
    if (!rows.length) return setMessage("Add at least one product.");
    if (mpesaLeg && phone.replace(/\D/g, "").length < 9) return setMessage("Enter the M-PESA number that will receive the payment prompt.");
    const cashAmount = mode === "SPLIT" ? Number(splitCash) : total;
    const otherAmount = Number(splitOther);
    if (mode === "SPLIT" && (!(cashAmount > 0) || !(otherAmount > 0))) return setMessage("Enter both amounts. For a single method use Cash or M-PESA on its own.");
    if (mode === "SPLIT" && !splitPaymentBalances(total, [{ amount: cashAmount }, { amount: otherAmount }])) return setMessage(`The two amounts must add up to ${money(total)}.`);
    if ((mode === "CASH" || mode === "SPLIT") && change === null) return setMessage(mode === "SPLIT" ? `The cash handed over is less than the ${money(cashPortion)} cash part of this bill.` : "The cash handed over is less than the amount due.");
    const payments = mode === "SPLIT" ? [
      { method: "CASH", amount: cashAmount, cashReceived: Number(cashReceived) },
      { method: splitMethod, amount: otherAmount, phone },
    ] : [{ method: mode, amount: total, cashReceived: mode === "CASH" ? Number(cashReceived) : undefined, phone }];
    setSending(true); setMessage("");
    const response = await fetch("/api/walk-in-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, heldSaleId, customerName, phone, email, checkoutToken: checkoutToken.current, discountAmount: Number(discount) || 0, chargeVat: showVat, items: rows.map((row) => ({ productId: row.id, quantity: row.quantity })), payments }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(body?.error || "The sale could not be completed.");
    else {
      pollCount.current = 0;
      setCheckout(null);
      setSale({ id: body.id, orderNumber: body.orderNumber, total: Number(body.total), checkoutToken: checkoutToken.current, state: body.paid ? "COMPLETE" : body.paymentStatus === "FAILED" ? "FAILED" : "WAITING", receiptNumber: body.receiptNumber, message: body.message || (body.paid ? "Sale completed." : "Waiting for payment confirmation.") });
    }
    setSending(false);
  }
  async function retryPayment() {
    setSending(true);
    const response = await fetch("/api/payments/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: sale?.checkoutToken, billingPhone: phone }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(body?.error || "The payment could not be retried.");
    else setSale((current) => current ? { ...current, state: body.paymentStatus === "PAID" ? "COMPLETE" : "WAITING", message: body.message || "Approve the new prompt." } : current);
    setSending(false);
  }
  async function cancelPayment() {
    if (!sale) return;
    setSending(true);
    const response = await fetch("/api/payments/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: sale.checkoutToken }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setSale((current) => current ? { ...current, message: body?.error || "The pending sale could not be cancelled." } : current);
    else setSale((current) => current ? { ...current, state: "CANCELLING", message: body.message || "Checking for a late M-PESA confirmation before releasing stock." } : current);
    setSending(false);
  }
  function toggleAutoPrint() {
    setAutoPrint((current) => {
      const next = !current;
      window.localStorage.setItem("healthfield:pos:auto-print", String(next));
      return next;
    });
  }
  function toggleVat() { setShowVat((current) => !current); setMessage(""); }
  function printReceipt() {
    if (!sale) return;
    window.open(`${backHref}/receipts/orders/${sale.id}?autoPrint=1`, "_blank", "noopener,noreferrer");
  }
  async function submitManualProof(event: FormEvent) {
    event.preventDefault(); if (manualProof.trim().length < 10) return;
    setSending(true);
    const response = await fetch("/api/payments/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: sale?.checkoutToken, message: manualProof.trim() }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(body?.error || "The receipt could not be checked.");
    else if (body.paid) setSale((current) => current ? { ...current, state: "COMPLETE", message: "Till payment confirmed." } : current);
    else if (body.candidatePayment || body.candidatePayments?.length) setSale((current) => current ? { ...current, state: "VERIFYING", candidate: body.candidatePayment || null, candidates: body.candidatePayments, message: body.message } : current);
    else setSale((current) => current ? { ...current, state: "REVIEWING", message: body.message } : current);
    setSending(false);
  }
  async function confirmTill(candidate: TillCandidate) {
    setSending(true);
    const response = await fetch(`/api/payments/incoming/${candidate.id}/confirm-pos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken: sale?.checkoutToken }) }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setMessage(body?.error || "The Till payment could not be confirmed.");
    else setSale((current) => current ? { ...current, state: "COMPLETE", receiptNumber: body.receiptNumber, message: body.message || "Till payment confirmed." } : current);
    setSending(false);
  }

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link href={backHref} className={styles.logoBlock}><strong>Healthfield</strong><span>Pharmacy POS</span></Link>
      <div><small>Branch</small><strong>{session.branchName}</strong></div>
      <div><small>Cashier</small><strong>{data.cashier.name}</strong></div>
      <div><small>Kenya time</small><strong>{nairobiDateTime(clock)}</strong></div>
      <button className={styles.sessionChip} onClick={() => setPanel("close")}><i/> Session active <span>View / close</span></button>
    </header>
    <nav className={styles.actions}>
      <button className={styles.primaryAction} onClick={resetSale}><Plus/> New Sale</button>
      <button onClick={() => setPanel("held")}><Pause/> Held Sales <b>{data.heldSales.length}</b></button>
      <button onClick={() => setPanel("stock")}><PackagePlus/> Receive Stock</button>
      <button onClick={() => setPanel("expense")}><HandCoins/> Expenses</button>
      <button onClick={() => setPanel("reports")}><BarChart3/> Reports</button>
      <button className={autoPrint ? styles.printToggleOn : styles.printToggle} aria-pressed={autoPrint} onClick={toggleAutoPrint}><Printer/> Auto-print {autoPrint ? "on" : "off"}</button>
      <button className={showVat ? styles.printToggleOn : undefined} aria-pressed={showVat} disabled={!vatRate} title={vatRate ? "Add VAT to this sale" : "Set a VAT rate in settings first"} onClick={toggleVat}><Percent/> VAT {showVat ? "on" : "off"}</button>
    </nav>
    <div className={styles.workspace}>
      <section className={styles.catalogue}>
        <div className={styles.searchRow}>
          <label><Search/><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const exact = data.products.find((product) => [product.barcode, product.sku].filter(Boolean).some((value) => value!.toLowerCase() === query.trim().toLowerCase())); if (exact) scanValue(query); else if (products[0]) addProduct(products[0]); } }} placeholder="Search product, barcode, SKU or brand" autoComplete="off"/></label>
          <button onClick={() => setCameraOpen(true)}><Camera/> Camera</button>
        </div>
        {message ? <p className={styles.notice} role="status">{message}</p> : null}
        <div className={styles.productHead}><span>Product</span><span>Price</span><span>Stock</span><span>Add</span></div>
        <div className={styles.productList}>{products.map((product) => {
          const available = availability.get(product.id) || 0; const low = available <= (data.stock.find((row) => row.branchId === session.branchId && row.productId === product.id)?.reorderLevel || 5);
          return <button key={product.id} className={styles.productRow} onClick={() => addProduct(product)}>
            <span className={styles.productName}>{product.imageUrl ? <Image src={product.imageUrl} alt="" width={42} height={42} sizes="42px" unoptimized/> : <ReceiptText/>}<span><strong>{product.name}</strong><small>{product.brand || product.sku}{product.packSize ? ` · ${product.packSize}` : ""}{product.barcode ? ` · ${product.barcode}` : ""}</small></span></span>
            <strong>{money(product.discountPrice ?? product.price)}</strong><span className={low ? styles.low : styles.inStock}>{low ? "Low " : "In stock "}{available}</span><Plus/>
          </button>;
        })}</div>
        <footer className={styles.pagination}><span>Showing {products.length} of {filtered.length} products</span><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft/></button><b>{Math.min(page, pages)} / {pages}</b><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight/></button></footer>
      </section>
      <section className={styles.salePanel} ref={salePanelRef}>
        <header><ShoppingCart/><strong>Current sale</strong><b>{cartCount}</b>{rows.length ? <button type="button" className={styles.clearCart} onClick={() => { setCart({}); setDiscount(""); setMessage("Sale cleared."); }}>Clear</button> : null}</header>
        <div className={styles.cart}>{rows.length ? rows.map((row) => <div className={styles.cartRow} key={row.id}>
          <span><strong>{row.name}</strong><small>{money(row.discountPrice ?? row.price)} each</small></span>
          <div><button onClick={() => setQuantity(row.id, row.quantity - 1)}><Minus/></button><input type="number" min="1" max={row.available} value={row.quantity} onChange={(event) => setQuantity(row.id, Number(event.target.value))}/><button onClick={() => setQuantity(row.id, row.quantity + 1)}><Plus/></button></div>
          <strong>{money((row.discountPrice ?? row.price) * row.quantity)}</strong><button className={styles.remove} onClick={() => setQuantity(row.id, 0)}><X/></button>
        </div>) : <div className={styles.emptyCart}><ShoppingCart/><strong>Start a new sale</strong><span>Search, scan, or tap a product.</span></div>}</div>
        <div className={styles.totals}><label>Discount (KES)<input type="number" min="0" max={subtotal} step=".01" value={discount} onChange={(event) => setDiscount(event.target.value)}/></label><p><span>Subtotal</span><b>{money(subtotal)}</b></p><p><span>Discount</span><b>- {money(Number(discount) || 0)}</b></p>{vatAmount !== null ? <p className={styles.vatLine}><span>{vatRateLabel(vatRate)}</span><b>+ {money(vatAmount)}</b></p> : null}<p className={styles.grand}><span>Total</span><b>{money(total)}</b></p></div>
        <button type="button" className={customerSummary ? styles.customerChipOn : styles.customerChip} onClick={() => { setMessage(""); setCheckout("DETAILS"); }}><UserRound/><span><small>Customer</small><strong>{customerSummary || "Walk-in — tap to add name, phone or email"}</strong></span><ChevronRight/></button>
        <button className={styles.payButton} disabled={sending || !rows.length || total <= 0} onClick={openCheckout}>{sending ? <LoaderCircle className={styles.spin}/> : <CircleDollarSign/>}{sending ? "Processing…" : `Charge ${money(total)}`}</button>
      </section>
    </div>
    {rows.length ? <div className={styles.mobileBar}>
      <button type="button" onClick={() => salePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><small>{cartCount} item{cartCount === 1 ? "" : "s"} · view sale</small><strong>{money(total)}</strong></button>
      <button type="button" className={styles.mobileCharge} onClick={openCheckout}><CircleDollarSign/> Charge</button>
    </div> : null}
    {checkout ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Take payment">
      <section className={styles.sheet}>
        <header>{checkout === "DETAILS" ? <button type="button" className={styles.sheetBack} onClick={() => setCheckout("METHOD")}><ChevronLeft/> Payment method</button> : <strong>Take payment</strong>}<button type="button" aria-label="Close payment" onClick={() => setCheckout(null)}><X/></button></header>
        <div className={styles.sheetTotal}><small>Amount due</small><strong>{money(total)}</strong><span>{cartCount} item{cartCount === 1 ? "" : "s"} · {session.branchName} · {data.cashier.name}</span>{vatAmount !== null ? <em className={styles.sheetVat}>Includes {vatRateLabel(vatRate)} of {money(vatAmount)}</em> : null}</div>
        {checkout === "METHOD" ? <div className={styles.methodGrid}>
          {data.payment.cashEnabled ? <button type="button" onClick={() => chooseMode("CASH")}><Banknote/><b>Cash</b><small>Count cash and give change</small></button> : null}
          {data.payment.mpesaEnabled ? <button type="button" onClick={() => chooseMode("MPESA_EXPRESS")}><Smartphone/><b>M-PESA prompt</b><small>Push a payment request to the customer phone</small></button> : null}
          {data.payment.manualEnabled ? <button type="button" onClick={() => chooseMode("MANUAL_MPESA")}><CreditCard/><b>Till number</b><small>Customer pays Till {data.payment.tillNumber} themselves</small></button> : null}
          {data.payment.cashEnabled && (data.payment.mpesaEnabled || data.payment.manualEnabled) ? <button type="button" onClick={() => chooseMode("SPLIT")}><RotateCcw/><b>Split</b><small>Part cash, part M-PESA</small></button> : null}
        </div> : <div className={styles.sheetBody}>
          <div className={styles.sheetSection}>
            <h3>{mode === "CASH" ? "Cash payment" : mode === "MPESA_EXPRESS" ? "M-PESA prompt" : mode === "MANUAL_MPESA" ? "Till payment" : "Split payment"}</h3>
            {mode === "SPLIT" ? <div className={styles.splitRows}>
              <label className={styles.splitRow}><span>Cash</span><input type="number" inputMode="decimal" min="0" max={total} step=".01" value={splitCash} onChange={(event) => editSplitCash(event.target.value)} onKeyDown={digitsOnly} placeholder="0.00"/></label>
              <div className={styles.splitRow}><select value={splitMethod} onChange={(event) => setSplitMethod(event.target.value as typeof splitMethod)} aria-label="Second payment method">{data.payment.mpesaEnabled ? <option value="MPESA_EXPRESS">M-PESA prompt</option> : null}{data.payment.manualEnabled ? <option value="MANUAL_MPESA">Till payment</option> : null}</select><input type="number" inputMode="decimal" min="0" max={total} step=".01" value={splitOther} onChange={(event) => editSplitOther(event.target.value)} onKeyDown={digitsOnly} placeholder="0.00" aria-label="Second payment amount"/></div>
            </div> : null}
            {cashLeg ? <div className={styles.splitRows}>
              <label className={styles.splitRow}><span>{mode === "SPLIT" ? "Cash given" : "Cash"}</span><input type="number" inputMode="decimal" min="0" step=".01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} onKeyDown={digitsOnly} placeholder="0.00"/></label>
              <div className={styles.tenders}>{tenders.map((value) => <button key={value} type="button" onClick={() => setCashReceived(String(value))}>{value === tenders[0] ? "Exact" : money(value)}</button>)}</div>
              <p className={`${styles.changeLine} ${change === null ? styles.changeShort : ""}`}><span>Change{mode === "SPLIT" ? " on the cash part" : ""}</span><strong>{change === null ? `${money(Math.max(0, Math.min(total, cashPortion) - (Number(cashReceived) || 0)))} short` : money(change)}</strong></p>
            </div> : null}
            {mpesaLeg ? <p className={styles.methodNote}>The customer approves the prompt with their M-PESA PIN.</p> : null}
            {tillLeg ? <div className={styles.tillNote}><b>Till {data.payment.tillNumber}</b><span>{data.payment.accountName || "Healthfield Pharmacy"} · reference created when the sale starts.</span></div> : null}
          </div>
          <div className={styles.sheetSection}>
            <h3>Customer <em>{mpesaLeg ? "M-PESA number required" : "optional"}</em></h3>
            <div className={styles.sheetFields}>
              <label className={styles.full}>Name<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Walk-in customer" autoComplete="off"/></label>
              <label>{mpesaLeg ? "M-PESA number" : "Phone"}<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="07XX XXX XXX" autoComplete="off"/></label>
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" autoComplete="off"/></label>
            </div>
          </div>
          {message ? <p className={styles.error}>{message}</p> : null}
        </div>}
        {checkout === "DETAILS" ? <div className={styles.sheetFoot}>
          <button className={styles.confirmPay} disabled={sending || !rows.length || total <= 0} onClick={submitSale}>{sending ? <LoaderCircle className={styles.spin}/> : <CircleDollarSign/>}{sending ? "Processing…" : `Pay ${money(total)}`}</button>
        </div> : null}
      </section>
    </div> : null}
    {cameraOpen ? <CameraScanner onClose={() => setCameraOpen(false)} onCode={handleCameraCode}/>: null}
    {panel ? <PosPanel panel={panel} close={() => setPanel(null)} data={data} session={session} products={data.products} current={{ cart, discount: Number(discount) || 0, customerName, phone, email }} onHeld={() => { setCart({}); setDiscount(""); setCustomerName(""); setPhone(""); setEmail(""); setPanel(null); router.refresh(); }} onResume={(held) => { setCart(Object.fromEntries(held.cart.map((item) => [item.productId, item.quantity]))); setDiscount(String(held.discountAmount || "")); setCustomerName(held.customerName || ""); setPhone(held.phone || ""); setEmail(held.email || ""); setHeldSaleId(held.id); setPanel(null); }} onChanged={() => router.refresh()}/> : null}
    {autoPrint && sale?.state === "COMPLETE" ? <iframe className={styles.printFrame} title="Automatic receipt printing" src={`${backHref}/receipts/orders/${sale.id}?autoPrint=1`}/> : null}
    {sale ? <SaleStatus sale={sale} backHref={backHref} sending={sending} manualProof={manualProof} setManualProof={setManualProof} submitManualProof={submitManualProof} confirmTill={confirmTill} retry={retryPayment} cancel={cancelPayment} print={printReceipt} newSale={resetSale}/> : null}
  </main>;
}

function SaleStatus({ sale, backHref, sending, manualProof, setManualProof, submitManualProof, confirmTill, retry, cancel, print, newSale }: { sale: Sale; backHref: string; sending: boolean; manualProof: string; setManualProof: (value: string) => void; submitManualProof: (event: FormEvent) => void; confirmTill: (candidate: TillCandidate) => void; retry: () => void; cancel: () => void; print: () => void; newSale: () => void }) {
  return <div className={styles.overlay}><section className={styles.statusCard}>{sale.state === "COMPLETE" || sale.state === "CANCELLED" ? <CheckCircle2 className={styles.successIcon}/> : ["WAITING", "REVIEWING", "CANCELLING"].includes(sale.state) ? <LoaderCircle className={`${styles.statusIcon} ${styles.spin}`}/> : <WalletCards className={styles.statusIcon}/>}<span className={styles.eyebrow}>{sale.orderNumber}</span><h2>{sale.state === "COMPLETE" ? "Sale complete" : sale.state === "CANCELLED" ? "Sale cancelled" : sale.state === "CANCELLING" ? "Cancelling safely" : sale.state === "FAILED" ? "Payment needs action" : sale.state === "VERIFYING" ? "Confirm the payer" : "Payment in progress"}</h2><strong className={styles.statusTotal}>{money(sale.total)}</strong><p>{sale.message}</p>
    {sale.state === "VERIFYING" ? <div className={styles.candidates}>{[...(sale.candidate ? [sale.candidate] : []), ...(sale.candidates || [])].map((candidate) => <button key={candidate.id} disabled={sending} onClick={() => confirmTill(candidate)}><b>{candidate.payerName || "Payer name unavailable"}</b><span>{candidate.receiptNumber} · {money(candidate.amount)}</span><small>{candidate.accountReference || "No reference"}</small></button>)}</div> : null}
    {["WAITING", "REVIEWING"].includes(sale.state) ? <form className={styles.proof} onSubmit={submitManualProof}><input value={manualProof} onChange={(event) => setManualProof(event.target.value)} placeholder="Receipt code or full M-PESA SMS"/><button disabled={sending || manualProof.trim().length < 10}>Verify receipt</button><small>Use only if the automatic Till callback is delayed. Never request a second payment.</small></form> : null}
    <div className={styles.statusActions}>{sale.state === "COMPLETE" ? <><button onClick={print}><Printer/> Print receipt</button><Link href={`${backHref}/receipts/orders/${sale.id}`}>Open receipt</Link><button onClick={newSale}>New sale</button></> : sale.state === "CANCELLED" ? <button onClick={newSale}>New sale</button> : sale.state === "FAILED" ? <><button disabled={sending} onClick={retry}>Retry M-PESA</button><button disabled={sending} onClick={cancel}>Cancel safely</button><button onClick={newSale}>Leave pending sale</button></> : sale.state === "CANCELLING" ? <small>Keep this sale open while Healthfield checks for a late confirmation. It will release stock automatically if none arrived.</small> : <small>You may leave this screen; the session cannot close while payment remains pending.</small>}</div>
  </section></div>;
}

type DetectorApi = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };

/** The camera is best-effort: it must never block the cashier, so every failure falls back to typing the code. */
function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const codeRef = useRef(onCode);
  const [message, setMessage] = useState("Starting camera…");
  const [live, setLive] = useState(false);
  const [manual, setManual] = useState("");
  useEffect(() => { codeRef.current = onCode; }, [onCode]);
  useEffect(() => {
    let stream: MediaStream | null = null; let stopped = false; let timer = 0;
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        return setMessage("Browsers only open the camera on a secure (https) address. Open the POS over https or on this computer, use a USB or Bluetooth scanner, or type the barcode below.");
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        return setMessage(name === "NotAllowedError" ? "Camera access is blocked for this site. Allow the camera in your browser settings and try again, or type the barcode below."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "No camera was found on this device. Use a USB or Bluetooth scanner, or type the barcode below."
          : name === "NotReadableError" ? "The camera is already in use by another app. Close it and try again, or type the barcode below."
          : "The camera could not be started. Type the barcode below instead.");
      }
      if (stopped || !video.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setLive(true);
      const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => DetectorApi }).BarcodeDetector;
      let detector: DetectorApi | null = null;
      try { detector = Detector ? new Detector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"] }) : null; } catch { detector = null; }
      if (!detector) return setMessage("This browser cannot read barcodes automatically. Read the code on screen and type it below, or use a USB or Bluetooth scanner.");
      setMessage("Hold the barcode inside the frame.");
      async function detect() {
        if (stopped || !video.current) return;
        const codes = await detector!.detect(video.current).catch(() => [] as Array<{ rawValue: string }>);
        const value = codes[0]?.rawValue?.trim();
        if (value) return codeRef.current(value);
        timer = window.setTimeout(detect, 300);
      }
      timer = window.setTimeout(detect, 400);
    }
    void start();
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, []);
  function submitManual(event: FormEvent) { event.preventDefault(); const value = manual.trim(); if (value.length >= 3) codeRef.current(value); }
  return <div className={styles.overlay}><section className={styles.camera}>
    <header><strong>Scan a barcode</strong><button type="button" aria-label="Close the scanner" onClick={onClose}><X/></button></header>
    <div className={live ? styles.cameraView : `${styles.cameraView} ${styles.cameraOff}`}><video ref={video} playsInline muted/>{live ? <i/> : null}</div>
    <p>{message}</p>
    <form className={styles.manualCode} onSubmit={submitManual}>
      <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Type or scan the barcode / SKU" inputMode="text" autoComplete="off"/>
      <button disabled={manual.trim().length < 3}>Add</button>
    </form>
  </section></div>;
}

type PanelProps = { panel: Exclude<Panel, null>; close: () => void; data: PosWorkspaceData; session: NonNullable<PosWorkspaceData["activeSession"]>; products: PosProduct[]; current: { cart: Record<number, number>; discount: number; customerName: string; phone: string; email: string }; onHeld: () => void; onResume: (held: HeldSale) => void; onChanged: () => void };
function PosPanel(props: PanelProps) {
  return <div className={styles.overlay}><section className={styles.drawer}><header><h2>{props.panel === "held" ? "Held sales" : props.panel === "stock" ? "Receive stock" : props.panel === "expense" ? "Session expenses" : props.panel === "reports" ? "POS reports" : "Close session"}</h2><button onClick={props.close}><X/></button></header>{props.panel === "held" ? <HeldPanel {...props}/> : props.panel === "stock" ? <StockPanel {...props}/> : props.panel === "expense" ? <ExpensePanel {...props}/> : props.panel === "reports" ? <ReportsPanel {...props}/> : <ClosePanel {...props}/>}</section></div>;
}

function HeldPanel({ data, session, current, onHeld, onResume, onChanged }: PanelProps) {
  const [label, setLabel] = useState(current.customerName || `Held ${nairobiDateTime(new Date())}`); const [message, setMessage] = useState("");
  async function hold() { const cart = Object.entries(current.cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity })); if (!cart.length) return setMessage("There is no current sale to hold."); const response = await fetch("/api/pos/held-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, label, customerName: current.customerName, phone: current.phone, email: current.email, cart, discountAmount: current.discount }) }); const body = await response.json().catch(() => ({})); if (!response.ok) setMessage(body.error || "Sale could not be held."); else onHeld(); }
  async function act(held: HeldSale, action: "RESUME" | "CANCEL") { const response = await fetch(`/api/pos/held-sales/${held.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); if (response.ok) { if (action === "RESUME") onResume(held); else onChanged(); } }
  return <div className={styles.panelBody}><div className={styles.holdCurrent}><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Name this held sale"/><button onClick={hold}><Pause/> Hold current sale</button></div>{message ? <p className={styles.error}>{message}</p> : null}<div className={styles.recordList}>{data.heldSales.map((held) => <article key={held.id}><div><strong>{held.label}</strong><span>{held.cart.reduce((sum, row) => sum + row.quantity, 0)} item(s) · {nairobiDateTime(held.heldAt)}</span></div><button onClick={() => act(held, "RESUME")}>Resume</button><button onClick={() => act(held, "CANCEL")}><Trash2/></button></article>)}{!data.heldSales.length ? <p>No held sales in this session.</p> : null}</div></div>;
}

function ExpensePanel({ data, session, onChanged }: PanelProps) {
  const [category, setCategory] = useState("Petty cash"); const [description, setDescription] = useState(""); const [amount, setAmount] = useState(""); const [paymentMethod, setPaymentMethod] = useState<"CASH" | "MPESA" | "OTHER">("CASH"); const [reference, setReference] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) { event.preventDefault(); if (saving) return; setSaving(true); setMessage(""); const recorded = Number(amount) || 0; const response = await fetch("/api/pos/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.id, category, description, amount, paymentMethod, reference }) }).catch(() => null); const body = await response?.json().catch(() => ({})); if (!response?.ok) setMessage(body?.error || "Expense could not be recorded."); else { setDescription(""); setAmount(""); setReference(""); setMessage(`Recorded ${money(recorded)} against this session.`); onChanged(); } setSaving(false); }
  async function remove(id: number) { if (!confirm("Remove this expense from the open session?")) return; const response = await fetch(`/api/pos/expenses/${id}`, { method: "DELETE" }); if (response.ok) onChanged(); }
  return <div className={styles.panelBody}><form className={styles.formGrid} onSubmit={save}><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Petty cash</option><option>Transport</option><option>Utilities</option><option>Supplies</option><option>Staff welfare</option><option>Other</option></select></label><label>Amount<input type="number" min=".01" step=".01" value={amount} onChange={(event) => setAmount(event.target.value)} required/></label><label>Paid through<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash drawer</option><option value="MPESA">M-PESA</option><option value="OTHER">Other</option></select></label><label>Reference / voucher<input value={reference} onChange={(event) => setReference(event.target.value)}/></label><label className={styles.full}>Description<input value={description} onChange={(event) => setDescription(event.target.value)} required/></label><button disabled={saving}>{saving ? "Recording…" : "Record expense"}</button></form>{message ? <p className={message.startsWith("Recorded") ? styles.success : styles.error}>{message}</p> : null}<div className={styles.recordList}>{data.expenses.map((expense) => <article key={expense.id}><div><strong>{expense.category} · {money(expense.amount)}</strong><span>{expense.description} · {expense.paymentMethod} · {nairobiDateTime(expense.incurredAt)}</span></div><button onClick={() => remove(expense.id)}><Trash2/></button></article>)}{!data.expenses.length ? <p>No expenses in this session.</p> : null}</div></div>;
}

type StockLine = { productId: number; quantity: string; buyingPrice: string; batchNumber: string; expiryDate: string };
function StockPanel({ data, products, session, onChanged }: PanelProps) {
  const [supplierName, setSupplierName] = useState(""); const [supplierPhone, setSupplierPhone] = useState(""); const [invoice, setInvoice] = useState(""); const [file, setFile] = useState<File | null>(null); const [lines, setLines] = useState<StockLine[]>([{ productId: products[0]?.id || 0, quantity: "", buyingPrice: "", batchNumber: "", expiryDate: "" }]); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  function changeSupplier(value: string) { setSupplierName(value); const match = data.suppliers.find((supplier) => supplier.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()); setSupplierPhone(match?.phone || ""); }
  function update(index: number, change: Partial<StockLine>) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...change } : line)); }
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setMessage(""); const form = new FormData(); form.set("sessionId", String(session.id)); form.set("supplierName", supplierName); form.set("supplierPhone", supplierPhone); form.set("supplierInvoice", invoice); form.set("items", JSON.stringify(lines.map((line) => ({ ...line, quantity: Number(line.quantity), buyingPrice: Number(line.buyingPrice), expiryDate: line.expiryDate || null })))); if (file) form.set("receiptImage", file); const response = await fetch("/api/pos/stock-receipts", { method: "POST", body: form }).catch(() => null); const body = await response?.json().catch(() => ({})); if (!response?.ok) setMessage(body?.error || "Stock could not be received."); else { setMessage(`${body.receiptNumber} saved. Stock is updated.`); setLines([{ productId: products[0]?.id || 0, quantity: "", buyingPrice: "", batchNumber: "", expiryDate: "" }]); setSupplierName(""); setSupplierPhone(""); setInvoice(""); setFile(null); onChanged(); } setSaving(false); }
  return <div className={styles.panelBody}><form onSubmit={save}><div className={styles.formGrid}><label>Supplier<input list="pos-suppliers" value={supplierName} onChange={(event) => changeSupplier(event.target.value)} placeholder="Search or enter a new supplier" autoComplete="off" required/><datalist id="pos-suppliers">{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.name}>{supplier.phone || "Saved supplier"}</option>)}</datalist><small>Choose a saved supplier or type a new name. New suppliers are saved automatically.</small></label><label>Supplier phone<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} placeholder="Filled from saved supplier"/></label><label>Invoice / delivery note<input value={invoice} onChange={(event) => setInvoice(event.target.value)}/></label><label>Receipt image or PDF<input type="file" accept="image/*,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)}/></label></div><div className={styles.stockToolbar}><span>Products delivered</span><div>{data.cashier.role !== "STAFF" ? <Link href="/admin/products?new=1" target="_blank"><Plus/> Add new product</Link> : null}<button type="button" onClick={onChanged}><RotateCcw/> Refresh products</button></div></div><div className={styles.stockLines}>{lines.map((line, index) => <div key={index}><select aria-label={`Product ${index + 1}`} value={line.productId} onChange={(event) => update(index, { productId: Number(event.target.value) })}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" placeholder="Quantity" value={line.quantity} onChange={(event) => update(index, { quantity: event.target.value })} required/><input aria-label={`Buying price ${index + 1}`} type="number" min=".01" step=".01" placeholder="Buying price" value={line.buyingPrice} onChange={(event) => update(index, { buyingPrice: event.target.value })} required/><input aria-label={`Batch number ${index + 1} optional`} placeholder="Batch (optional)" value={line.batchNumber} onChange={(event) => update(index, { batchNumber: event.target.value })}/><input aria-label={`Expiry date ${index + 1} optional`} type="date" value={line.expiryDate} onChange={(event) => update(index, { expiryDate: event.target.value })}/><button type="button" aria-label={`Remove product row ${index + 1}`} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2/></button></div>)}</div><div className={styles.formActions}><button type="button" onClick={() => setLines((current) => [...current, { productId: products[0]?.id || 0, quantity: "", buyingPrice: "", batchNumber: "", expiryDate: "" }])}><Plus/> Add another line</button><button disabled={saving}>{saving ? "Receiving…" : "Receive stock"}</button></div></form>{message ? <p className={message.includes("saved") ? styles.success : styles.error}>{message}</p> : null}</div>;
}

function ClosePanel({ data, session, onChanged, close }: PanelProps) {
  const totals = data.totals; const [actual, setActual] = useState(""); const [notes, setNotes] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [confirming, setConfirming] = useState(false); const difference = (Number(actual) || 0) - (totals?.expectedCash || 0);
  async function submit(event: FormEvent) { event.preventDefault(); if (!confirming) { setConfirming(true); return; } setSaving(true); const response = await fetch(`/api/pos/sessions/${session.id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualCash: actual, notes }) }).catch(() => null); const body = await response?.json().catch(() => ({})); if (!response?.ok) { setMessage(body?.error || "Session could not be closed."); setConfirming(false); } else { const branchStatus = body.notifications?.branchFullyClosed ? "This was the branch's last open session." : body.notifications?.remainingOpenSessions ? `${body.notifications.remainingOpenSessions} other branch session(s) remain open.` : ""; setMessage(`Session closed. ${branchStatus} Email ${body.notifications?.emailSent ? "sent" : "not sent"}; ${body.notifications?.smsSent || 0} SMS delivered.`); onChanged(); window.setTimeout(close, 1600); } setSaving(false); }
  return <div className={styles.panelBody}><div className={styles.closeSummary}><p><span>Opening float</span><b>{money(session.openingFloat)}</b></p><p><span>Opening cash</span><b>{money(session.openingCash)}</b></p><p><span>Cash sales</span><b>{money(totals?.cashSales || 0)}</b></p><p><span>M-PESA sales</span><b>{money((totals?.mpesaSales || 0) + (totals?.manualSales || 0))}</b></p><p><span>Discounts</span><b>{money(totals?.discounts || 0)}</b></p><p><span>Expenses</span><b>{money(totals?.expenses || 0)}</b></p><p className={styles.expected}><span>Expected cash</span><b>{money(totals?.expectedCash || session.openingCash)}</b></p></div><form className={styles.formGrid} onSubmit={submit}><label>Actual cash counted<input type="number" min="0" step=".01" value={actual} onChange={(event) => { setActual(event.target.value); setConfirming(false); }} required/><small className={difference < 0 ? styles.low : styles.inStock}>{actual ? `${difference < 0 ? "Shortage" : "Surplus"}: ${money(Math.abs(difference))}` : "Count the complete drawer."}</small></label><label className={styles.full}>Closing notes<textarea value={notes} onChange={(event) => { setNotes(event.target.value); setConfirming(false); }} rows={3}/></label>{confirming ? <div className={`${styles.confirmClose} ${styles.full}`} role="alert"><strong>Lock this cashier session?</strong><span>No more sales, expenses or stock receipts can be added. The session-specific branch report will be sent to the owner.</span><div><button type="button" onClick={() => setConfirming(false)}>Keep session open</button><button type="submit" disabled={saving}>{saving ? "Closing…" : "Yes, close and report"}</button></div></div> : <button disabled={saving}>Close and send report</button>}</form>{message ? <p className={message.startsWith("Session closed") ? styles.success : styles.error}>{message}</p> : null}<small>The PDF covers this exact cashier, branch, till and session. A branch-closed SMS is used only when no other session remains open there.</small></div>;
}

function ReportsPanel({ data }: PanelProps) {
  const kenyaDate = (date: Date) => { const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const value = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}`; }; const today = kenyaDate(new Date()); const monthAgo = kenyaDate(new Date(Date.now() - 30 * 24 * 60 * 60_000)); const [from, setFrom] = useState(monthAgo); const [to, setTo] = useState(today); const [branchId, setBranchId] = useState(""); const [cashierId, setCashierId] = useState(""); const [productId, setProductId] = useState(""); const [report, setReport] = useState<PosReport | null>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => { setLoading(true); setMessage(""); const params = new URLSearchParams({ from, to }); if (branchId) params.set("branchId", branchId); if (cashierId) params.set("cashierId", cashierId); if (productId) params.set("productId", productId); const response = await fetch(`/api/pos/reports?${params}`).catch(() => null); const body = await response?.json().catch(() => ({})); if (!response?.ok) setMessage(body?.error || "Reports could not be loaded."); else setReport(body); setLoading(false); }, [from, to, branchId, cashierId, productId]);
  useEffect(() => { void load(); }, [load]); const max = Math.max(1, ...(report?.dailySales.map((row) => row.sales) || [1]));
  return <div className={styles.panelBody}><div className={styles.reportFilters}><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><select value={cashierId} onChange={(event) => setCashierId(event.target.value)}><option value="">All cashiers</option>{(data.cashiers || [data.cashier]).map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}</select><select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">All products</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><button onClick={load}>{loading ? "Loading…" : "Apply"}</button></div>{message ? <p className={styles.error}>{message}</p> : null}{report ? <><div className={styles.reportMetrics}><article><small>Sales</small><b>{money(report.summary.sales)}</b></article><article><small>Transactions</small><b>{report.summary.orders}</b></article><article><small>Discounts</small><b>{money(report.summary.discounts)}</b></article><article><small>Refunds</small><b>{money(report.summary.refunds)}</b></article>{report.summary.profit !== null ? <article><small>Profit · owner only</small><b>{money(report.summary.profit)}</b></article> : null}</div><div className={styles.dailyChart}>{report.dailySales.map((row) => <div key={row.date}><span style={{ height: `${Math.max(3, row.sales / max * 100)}%` }}/><small>{row.date.slice(5)}</small><b>{money(row.sales)}</b></div>)}</div><div className={styles.reportGrid}><ReportTable title="Payment methods" rows={report.paymentMethods.map((row) => [row.method.replaceAll("_", " "), money(row.amount)])}/><ReportTable title="Cashier performance" rows={report.cashierPerformance.map((row) => [row.cashier, `${row.orders} sales · ${money(row.sales)}`])}/><ReportTable title="Best-selling products" rows={report.bestProducts.map((row) => [row.product, `${row.units} units · ${money(row.sales)}`])}/><ReportTable title="Cash differences" rows={report.sessions.filter((row) => row.cashDifference !== null).map((row) => [row.sessionNumber, `${row.cashDifference! < 0 ? "Short " : "Over "}${money(Math.abs(row.cashDifference!))}`])}/><ReportTable title="Low stock" rows={report.lowStock.map((row) => [`${row.product} · ${row.branch}`, `${row.available} left`])}/><ReportTable title="Expiring products" rows={report.expiringProducts.map((row) => [`${row.product} · ${row.batchNumber || "No batch"}`, `${row.expiryDate} · ${row.quantityRemaining} left`])}/><ReportTable title="Stock received" rows={report.stockReceived.map((row) => [`${row.product} · ${row.supplier}`, `${row.quantity} @ ${money(Number(row.buyingPrice))}`])}/></div></> : null}</div>;
}
function ReportTable({ title, rows }: { title: string; rows: string[][] }) { return <article className={styles.reportTable}><h3>{title}</h3>{rows.slice(0, 10).map((row, index) => <p key={`${row[0]}-${index}`}><span>{row[0]}</span><b>{row[1]}</b></p>)}{!rows.length ? <small>No records for this filter.</small> : null}</article>; }
