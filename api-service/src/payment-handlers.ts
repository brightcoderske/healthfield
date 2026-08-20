import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { activityLogs, branchInventory, mpesaIncomingPayments, mpesaStkCallbacks, orderItemFulfilments, orderItems, orders, paymentTransactions, siteSettings, users } from "../../db/schema";
import { requestSession, requireSession } from "./auth";
import { sendEmail } from "./email";
import { requireTeamPermission } from "./staff-permissions";
import { getDb } from "./db";
import { json } from "./http";
import { buildC2bCallbackUrls, classifyStkQueryResult, forbiddenCallbackWord, extractMpesaReceipt, initiateStkPush, mpesaConfiguration, parseC2bPayment, parsePullTransactions, parseStkCallback, parseTransactionStatusResult, pullTransactionsConfiguration, queryPulledTransactions, queryStkPush, queryTransactionStatus, registerC2bUrls, selectIncomingPaymentCandidate, selectPaymentForIncoming, stkBackgroundReconcileDelay, stkReconciliationReference, transactionStatusConfiguration, validDateOrNull, type IncomingMpesaPayment } from "./mpesa";
import { queuePaidOrderNotification } from "./order-notifications";
import { consumePosBatches } from "./pos-inventory";

const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
const admins = ["ADMIN", "SUPER_ADMIN"] as const;
const cancellationGraceMs = 2 * 60_000;
const pullRecoveryThrottleMs = 10 * 60_000;
const stkBackgroundChecks = new Map<number, number>();
const stkQueryCache = new Map<string, { checkedAt: number; result?: Awaited<ReturnType<typeof queryStkPush>>; pending?: Promise<Awaited<ReturnType<typeof queryStkPush>>> }>();
let stkBackgroundSweepRunning = false;
type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function paymentProviderSource(request: Request) {
  return String(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 64);
}

function callbackSummary(payload: Record<string, unknown>, receiptNumber?: string, amount?: number) {
  const receipt = String(receiptNumber || payload.TransID || payload.TransactionID || "").trim().toUpperCase();
  return {
    businessShortCode: String(payload.BusinessShortCode || payload.ShortCode || "").trim(),
    receiptSuffix: receipt ? receipt.slice(-4) : "",
    amount: Number.isFinite(amount) ? amount : Number(payload.TransAmount ?? payload.Amount) || null,
  };
}

async function throttledStkQuery(checkoutRequestId: string) {
  const now = Date.now();
  const cached = stkQueryCache.get(checkoutRequestId);
  if (cached?.pending) return cached.pending;
  if (cached?.result && now - cached.checkedAt < 5_000) return cached.result;
  const pending = queryStkPush(checkoutRequestId);
  stkQueryCache.set(checkoutRequestId, { checkedAt: now, pending });
  try {
    const result = await pending;
    stkQueryCache.set(checkoutRequestId, { checkedAt: Date.now(), result });
    return result;
  } catch (error) {
    stkQueryCache.delete(checkoutRequestId);
    throw error;
  }
}

async function finalizePosInventory(tx: DatabaseTransaction, orderId: number, actorId: number | null) {
  const items = await tx.select({ id: orderItems.id, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const relevant = items.length ? await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [];
  const plans: Array<{ item: typeof items[number]; fulfilment: typeof relevant[number]; stock: typeof branchInventory.$inferSelect; reserved: boolean }> = [];
  for (const item of items) {
    const fulfilment = relevant.find((row) => row.orderItemId === item.id);
    if (!fulfilment || item.productId === null) return false;
    const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, fulfilment.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
    if (!stock) return false;
    const reserved = fulfilment.quantityReserved >= item.quantity && stock.quantityReserved >= item.quantity;
    if (!reserved && stock.quantityAvailable - stock.quantityReserved < item.quantity) return false;
    plans.push({ item, fulfilment, stock, reserved });
  }
  for (const plan of plans) {
    await tx.update(branchInventory).set({
      quantityAvailable: plan.stock.quantityAvailable - plan.item.quantity,
      quantityReserved: plan.reserved ? plan.stock.quantityReserved - plan.item.quantity : plan.stock.quantityReserved,
      updatedBy: actorId,
    }).where(eq(branchInventory.id, plan.stock.id));
    await consumePosBatches(tx, plan.fulfilment.branchId, plan.item.productId!, plan.item.quantity);
    await tx.update(orderItemFulfilments).set({ quantityReserved: 0, quantityPacked: plan.item.quantity, status: "READY" }).where(eq(orderItemFulfilments.id, plan.fulfilment.id));
  }
  return true;
}

export async function markPaymentPaid(transactionId: number, details: { receiptNumber: string | null; amount: number; phone?: string | null; providerPayload?: Record<string, unknown>; actorId?: number | null; incomingPaymentId?: number }) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1).for("update");
    if (!payment) throw new Error("Payment record not found.");
    if (Math.abs(Number(payment.amount) - details.amount) > 0.001) {
      if (payment.status !== "PAID") await tx.update(paymentTransactions).set({ status: "REQUIRES_REVIEW", resultDescription: "The paid amount does not match the order total.", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
      throw new Error("The paid amount does not match the order total.");
    }
    if (payment.status === "PAID") {
      const replacingProvisionalReceipt = Boolean(
        details.receiptNumber &&
        payment.receiptNumber?.startsWith("STK-") &&
        payment.receiptNumber !== details.receiptNumber,
      );
      if (replacingProvisionalReceipt) {
        await tx.update(paymentTransactions).set({ receiptNumber: details.receiptNumber, phone: details.phone || payment.phone, providerPayload: details.providerPayload || payment.providerPayload }).where(eq(paymentTransactions.id, payment.id));
        await tx.update(orders).set({ paymentReference: details.receiptNumber }).where(eq(orders.id, payment.orderId));
        await tx.insert(activityLogs).values({ actorId: details.actorId ?? null, action: "PAYMENT_RECEIPT_UPDATED", entityType: "order", entityId: String(payment.orderId), metadata: { transactionId: payment.id, receiptNumber: details.receiptNumber } });
      }
      if (details.incomingPaymentId) await tx.update(mpesaIncomingPayments).set({ matchedTransactionId: payment.id }).where(and(eq(mpesaIncomingPayments.id, details.incomingPaymentId), isNull(mpesaIncomingPayments.matchedTransactionId)));
      return { orderId: payment.orderId, newlyPaid: false, inventoryFinalized: true };
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1).for("update");
    if (!order) throw new Error("Order not found.");
    if (order.paymentStatus === "PAID") {
      await tx.update(paymentTransactions).set({ status: "REQUIRES_REVIEW", receiptNumber: details.receiptNumber, resultDescription: "A second payment was received for an order that was already paid.", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
      return { orderId: order.id, newlyPaid: false, inventoryFinalized: true };
    }
    // A split sale has one payment row per tender. Confirming one component must never
    // complete the order or release stock as sold until all verified components equal
    // the final discounted total.
    const otherPaid = await tx.select({ amount: paymentTransactions.amount }).from(paymentTransactions).where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "PAID"), ne(paymentTransactions.id, payment.id)));
    const paidTotal = Math.round((otherPaid.reduce((sum, row) => sum + Number(row.amount), 0) + details.amount) * 100) / 100;
    const orderTotal = Number(order.total);
    if (paidTotal - orderTotal > 0.001) {
      await tx.update(paymentTransactions).set({ status: "REQUIRES_REVIEW", receiptNumber: details.receiptNumber, resultDescription: "Verified payment would exceed the order total.", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
      throw new Error("Verified payments exceed the order total.");
    }
    const fullyPaid = Math.abs(paidTotal - orderTotal) < 0.001;
    const inventoryFinalized = fullyPaid && (payment.channel !== "POS" || await finalizePosInventory(tx, order.id, details.actorId ?? null));
    const paidAt = new Date();
    await tx.update(paymentTransactions).set({ status: "PAID", receiptNumber: details.receiptNumber, phone: details.phone || payment.phone, verifiedAt: paidAt, reviewedBy: details.actorId ?? payment.reviewedBy, reviewedAt: details.actorId ? paidAt : validDateOrNull(payment.reviewedAt), resultCode: "0", resultDescription: fullyPaid ? inventoryFinalized ? "Payment confirmed" : "Payment confirmed after stock was released; fulfilment requires review." : "Payment component confirmed; waiting for the remaining split payment.", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
    if (details.incomingPaymentId) await tx.update(mpesaIncomingPayments).set({ matchedTransactionId: payment.id }).where(and(eq(mpesaIncomingPayments.id, details.incomingPaymentId), isNull(mpesaIncomingPayments.matchedTransactionId)));
    if (!fullyPaid) {
      await tx.update(orders).set({ amountPaid: paidTotal.toFixed(2), status: "AWAITING_PAYMENT", paymentStatus: "PENDING" }).where(eq(orders.id, order.id));
      await tx.insert(activityLogs).values({ actorId: details.actorId ?? null, action: "SPLIT_PAYMENT_COMPONENT_CONFIRMED", entityType: "order", entityId: String(order.id), metadata: { transactionId: payment.id, method: payment.method, receiptNumber: details.receiptNumber, amount: details.amount, amountPaid: paidTotal, total: orderTotal } });
      return { orderId: order.id, newlyPaid: false, inventoryFinalized: false, componentPaid: true, fullyPaid: false };
    }
    const paidOrderStatus = payment.channel === "POS" ? inventoryFinalized ? "COMPLETED" : "UNDER_REVIEW" : ["NEW", "AWAITING_PAYMENT", "CANCELLED"].includes(order.status) ? "CONFIRMED" : order.status;
    await tx.update(orders).set({ paymentStatus: "PAID", paymentReference: details.receiptNumber, amountPaid: paidTotal.toFixed(2), status: paidOrderStatus }).where(eq(orders.id, order.id));
    await tx.insert(activityLogs).values({ actorId: details.actorId ?? null, action: inventoryFinalized ? "PAYMENT_CONFIRMED" : "PAYMENT_CONFIRMED_STOCK_REVIEW", entityType: "order", entityId: String(order.id), metadata: { transactionId: payment.id, method: payment.method, receiptNumber: details.receiptNumber, amount: details.amount, amountPaid: paidTotal } });
    return { orderId: order.id, newlyPaid: true, inventoryFinalized, componentPaid: true, fullyPaid: true };
  });
  if (result.newlyPaid) queuePaidOrderNotification(result.orderId);
  return result;
}

/** A failed split component leaves already accepted cash visible and the order open. */
async function markOrderPaymentAttemptFailed(orderId: number) {
  const db = getDb();
  const paid = await db.select({ amount: paymentTransactions.amount }).from(paymentTransactions).where(and(eq(paymentTransactions.orderId, orderId), eq(paymentTransactions.status, "PAID")));
  const paidTotal = paid.reduce((sum, row) => sum + Number(row.amount), 0);
  await db.update(orders).set(paidTotal > 0
    ? { paymentStatus: "PENDING", status: "UNDER_REVIEW", amountPaid: paidTotal.toFixed(2) }
    : { paymentStatus: "FAILED" })
    .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "PENDING")));
}

function chooseIncomingPayment<T extends { receiptNumber: string; amount: string; accountReference: string | null; createdAt: Date }>(
  payment: typeof paymentTransactions.$inferSelect,
  orderNumber: string | null,
  recent: T[],
  now = Date.now(),
) {
  return selectIncomingPaymentCandidate({
    amount: payment.amount,
    receiptNumber: payment.receiptNumber,
    orderNumber,
    // Matching on amount alone is a counter rule. Online orders arrive from strangers
    // and are settled by the receipt they pasted, never by a coincidence of totals.
    allowAmountOnly: payment.channel === "POS" && ["PENDING", "CANCEL_REQUESTED", "REQUIRES_REVIEW", "FAILED", "CANCELLED"].includes(payment.status),
    recent,
    now,
  });
}

async function findIncomingPaymentCandidate(transactionId: number) {
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment || payment.method !== "MANUAL_MPESA" || payment.status === "PAID" || payment.status === "REFUNDED") return null;
  const [order] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  const recentRows = await db.select({
    ...getTableColumns(mpesaIncomingPayments),
    createdAtUnix: sql<number>`unix_timestamp(${mpesaIncomingPayments.createdAt})`,
    databaseNowUnix: sql<number>`unix_timestamp(current_timestamp)`,
  }).from(mpesaIncomingPayments).where(and(isNull(mpesaIncomingPayments.matchedTransactionId), sql`${mpesaIncomingPayments.createdAt} >= date_sub(current_timestamp, interval 24 hour)`)).orderBy(desc(mpesaIncomingPayments.createdAt)).limit(200);
  const now = recentRows.length ? Number(recentRows[0].databaseNowUnix) * 1000 : Date.now();
  const recent = recentRows.map(({ createdAtUnix, databaseNowUnix: _databaseNowUnix, ...row }) => ({ ...row, createdAt: new Date(Number(createdAtUnix) * 1000) }));
  return chooseIncomingPayment(payment, order?.orderNumber || null, recent, now);
}

async function findRecentIncomingAmountCandidates(transactionId: number) {
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment || payment.method !== "MANUAL_MPESA" || payment.status === "PAID" || payment.status === "REFUNDED") return [];
  return db.select().from(mpesaIncomingPayments).where(and(
    isNull(mpesaIncomingPayments.matchedTransactionId),
    sql`${mpesaIncomingPayments.createdAt} >= date_sub(current_timestamp, interval 30 minute)`,
    eq(mpesaIncomingPayments.amount, payment.amount),
  )).orderBy(desc(mpesaIncomingPayments.createdAt)).limit(20);
}

function incomingCandidatePayload(incoming: typeof mpesaIncomingPayments.$inferSelect | null) {
  return incoming ? { id:incoming.id, receiptNumber:incoming.receiptNumber, amount:Number(incoming.amount), phone:incoming.phone, payerName:incoming.payerName, accountReference:incoming.accountReference, receivedAt:incoming.createdAt } : null;
}

async function orderPaymentChannel(orderId: number, orderNumber: string) {
  const [payment] = await getDb().select({ channel: paymentTransactions.channel }).from(paymentTransactions).where(eq(paymentTransactions.orderId, orderId)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
  return payment?.channel ?? (orderNumber.startsWith("POS-") ? "POS" : "ONLINE");
}

export async function reconcileManualPaymentFromIncoming(transactionId: number) {
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment || payment.method !== "MANUAL_MPESA" || payment.status === "PAID" || payment.status === "REFUNDED") return { paid: payment?.status === "PAID", candidate: null };
  const candidate = await findIncomingPaymentCandidate(payment.id);
  if (!candidate) return { paid: false, candidate: null };

  // Online customers paste a receipt, so only that exact provider receipt may complete
  // the order automatically; anything else goes to an administrator. The POS counter is
  // where matching by amount is safe, because the seller is standing with the payer.
  if (payment.channel === "ONLINE" && candidate.receiptNumber !== payment.receiptNumber) return { paid: false, candidate: null };

  // Best effort by contract: every caller treats a failure here as "not settled yet"
  // and polls again, so a rejected completion must never surface as a server error on
  // the seller's screen mid-sale.
  try {
    await markPaymentPaid(payment.id, { receiptNumber:candidate.receiptNumber, amount:Number(candidate.amount), phone:candidate.phone, providerPayload:candidate.providerPayload || undefined, incomingPaymentId:candidate.id });
  } catch (error) {
    console.error("Till payment could not be completed automatically", { transactionId: payment.id, incomingPaymentId: candidate.id, error });
    return { paid: false, candidate: null };
  }
  return { paid: true, candidate };
}

async function paymentStatus(checkoutToken: string) {
  const db = getDb();
  const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, paymentStatus: orders.paymentStatus, paymentMethod: orders.paymentMethod, paymentReference: orders.paymentReference, amountPaid: orders.amountPaid, total: orders.total }).from(orders).where(eq(orders.checkoutToken, checkoutToken)).limit(1);
  if (!order) return null;
  const [payment] = await db.select({ id: paymentTransactions.id, method: paymentTransactions.method, status: paymentTransactions.status, resultCode: paymentTransactions.resultCode, resultDescription: paymentTransactions.resultDescription, receiptNumber: paymentTransactions.receiptNumber, updatedAt: paymentTransactions.updatedAt }).from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
  return { order, payment: payment || null };
}

export async function handlePaymentStatus(request: Request) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, { status: 405 });
  const token = new URL(request.url).searchParams.get("checkoutToken") || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Payment request not found." }, { status: 404 });
  const status = await paymentStatus(token);
  return status ? json(status) : json({ error: "Payment request not found." }, { status: 404 });
}

class PaymentRetryError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function handlePaymentRetry(request: Request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { checkoutToken?: string; orderId?: number; billingPhone?: string } | null;
  const checkoutToken = input?.checkoutToken || "";
  const orderId = Number(input?.orderId);
  if ((!/^[0-9a-f-]{36}$/i.test(checkoutToken)) && (!Number.isInteger(orderId) || orderId <= 0)) {
    return json({ error: "Payment request not found." }, { status: 400 });
  }

  const db = getDb();
  const session = await requestSession(request);
  const [candidate] = Number.isInteger(orderId) && orderId > 0
    ? await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    : await db.select().from(orders).where(eq(orders.checkoutToken, checkoutToken)).limit(1);
  if (!candidate) return json({ error: "Order not found." }, { status: 404 });

  const isPos = await orderPaymentChannel(candidate.id, candidate.orderNumber) === "POS";
  if (isPos) {
    if (!session || !team.includes(session.role as typeof team[number])) return json({ error: "You are not authorised to retry this counter sale." }, { status: 403 });
  } else if (Number.isInteger(orderId) && orderId > 0 && (!session || session.role !== "CUSTOMER" || candidate.customerId !== session.userId)) {
    return json({ error: "Order not found." }, { status: 404 });
  }

  const [settings] = await db.select({ onlineMpesaEnabled: siteSettings.onlineMpesaEnabled, posMpesaEnabled: siteSettings.posMpesaEnabled }).from(siteSettings).limit(1);
  if (!(isPos ? settings?.posMpesaEnabled : settings?.onlineMpesaEnabled) || !mpesaConfiguration()) {
    return json({ error: "M-Pesa Express is currently unavailable." }, { status: 409 });
  }

  const nextToken = candidate.checkoutToken || randomUUID();
  const phone = (input?.billingPhone || candidate.phone || "").trim();
  let paymentId = 0;
  let retryAmount = Number(candidate.total);
  try {
    paymentId = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, candidate.id)).limit(1).for("update");
      if (!order) throw new PaymentRetryError("Order not found.", 404);
      if (order.paymentStatus === "PAID") throw new PaymentRetryError("This order is already paid.");
      if (order.status === "CANCELLED" || order.paymentStatus === "REFUNDED") throw new PaymentRetryError("This order cannot be paid again.");
      const attempts = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt));
      const active = attempts.find((attempt) => ["INITIATED", "PENDING", "REQUIRES_REVIEW", "CANCEL_REQUESTED"].includes(attempt.status));
      if (active) throw new PaymentRetryError("A payment attempt is already active for this order.");
      const paidTotal = attempts.filter((attempt) => attempt.status === "PAID").reduce((sum, attempt) => sum + Number(attempt.amount), 0);
      const splitRetry = isPos && order.paymentMethod === "SPLIT" && paidTotal > 0;
      if (order.paymentStatus !== "FAILED" && !splitRetry) throw new PaymentRetryError("A payment attempt is already active for this order.");
      retryAmount = Math.round((Number(order.total) - paidTotal) * 100) / 100;
      if (retryAmount <= 0) throw new PaymentRetryError("This order has no unpaid balance.");
      const [created] = await tx.insert(paymentTransactions).values({ orderId: order.id, method: "MPESA_EXPRESS", channel: isPos ? "POS" : "ONLINE", status: "INITIATED", amount: retryAmount.toFixed(2), phone });
      await tx.update(orders).set({ checkoutToken: nextToken, paymentMethod: splitRetry ? "SPLIT" : "MPESA_EXPRESS", paymentStatus: "PENDING", paymentReference: splitRetry ? order.paymentReference : null }).where(eq(orders.id, order.id));
      await tx.insert(activityLogs).values({ actorId: session?.userId ?? null, action: "PAYMENT_RETRIED", entityType: "order", entityId: String(order.id), metadata: { transactionId: created.insertId, channel: isPos ? "POS" : "ONLINE", amount: retryAmount, splitRetry } });
      return created.insertId;
    });
  } catch (error) {
    if (error instanceof PaymentRetryError) return json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const stk = await initiateStkPush({ orderNumber: candidate.orderNumber, phone, amount: retryAmount });
    await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, paymentId));
    await replayStoredStkCallback(stk.checkoutRequestId);
    const status = await paymentStatus(nextToken);
    return json({ ok: true, checkoutToken: nextToken, paymentStatus: status?.order.paymentStatus || "PENDING", message: stk.customerMessage, ...status }, { status: status?.order.paymentStatus === "PAID" ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "M-Pesa Express could not start.";
    await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: message }).where(eq(paymentTransactions.id, paymentId));
    await markOrderPaymentAttemptFailed(candidate.id);
    return json({ error: message, paymentStatus: "FAILED" }, { status: 409 });
  }
}

export async function handleManualPayment(request: Request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { checkoutToken?: string; message?: string } | null;
  const checkoutToken = input?.checkoutToken || "", message = input?.message?.trim() || "";
  if (!/^[0-9a-f-]{36}$/i.test(checkoutToken) || message.length > 2500) return json({ error: "Payment request not found." }, { status: 400 });
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.checkoutToken, checkoutToken)).limit(1);
  if (!order) return json({ error: "Order not found." }, { status: 404 });
  const [settings] = await db.select({ onlineManualEnabled: siteSettings.onlineManualEnabled, posManualEnabled: siteSettings.posManualEnabled }).from(siteSettings).limit(1);
  const channel = await orderPaymentChannel(order.id, order.orderNumber);
  // An online customer must paste their receipt: nobody is at the counter to vouch for
  // who paid, so the code is the only thing tying a stranger's money to this order.
  if (channel === "ONLINE" && message.length < 10) return json({ error: "Paste the complete M-Pesa payment message." }, { status: 400 });
  const receiptNumber = message ? extractMpesaReceipt(message) : null;
  if (channel === "ONLINE" && !receiptNumber) return json({ error: "The M-Pesa receipt code could not be found. Paste the complete confirmation SMS." }, { status: 400 });
  if (channel === "POS" ? settings?.posManualEnabled === false : settings?.onlineManualEnabled === false) return json({ error: "Manual M-Pesa payment is currently unavailable." }, { status: 409 });
  if (order.paymentStatus === "PAID") return json({ ok: true, paid: true, orderNumber: order.orderNumber });
  let transaction: typeof paymentTransactions.$inferSelect;
  try {
    if (channel === "POS") {
      const [existing] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
      if (!existing) return json({ error: "Payment request not found." }, { status: 404 });
      if (message && !receiptNumber) return json({ error: "Enter a valid 10-character M-Pesa receipt code or paste the complete confirmation SMS." }, { status: 400 });
      await db.update(paymentTransactions).set(message ? {
        method: "MANUAL_MPESA",
        status: "REQUIRES_REVIEW",
        receiptNumber,
        manualMessage: message,
        checkoutRequestId: null,
        merchantRequestId: null,
        resultCode: null,
        resultDescription: "Receipt supplied at the till; waiting for administrator approval.",
      } : {
        method: "MANUAL_MPESA",
        status: "PENDING",
        receiptNumber: null,
        manualMessage: null,
        checkoutRequestId: null,
        merchantRequestId: null,
        resultCode: null,
        resultDescription: "Waiting for automatic till confirmation.",
      }).where(eq(paymentTransactions.id, existing.id));
      [transaction] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, existing.id)).limit(1);
    } else {
      const [created] = await db.insert(paymentTransactions).values({ orderId: order.id, method: "MANUAL_MPESA", channel, status: "REQUIRES_REVIEW", amount: order.total, phone: order.phone, receiptNumber, manualMessage: message });
      [transaction] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, created.insertId)).limit(1);
    }
  } catch {
    return json({ error: "That M-Pesa code has already been submitted for another payment." }, { status: 409 });
  }
  await db.update(orders).set({ paymentMethod: "MANUAL_MPESA", paymentStatus: "PENDING", paymentReference: receiptNumber }).where(eq(orders.id, order.id));
  const matched = await reconcileManualPaymentFromIncoming(transaction.id);
  if (matched.paid) return json({ ok:true, paid:true, orderNumber:order.orderNumber, receiptNumber:matched.candidate?.receiptNumber, message: channel === "POS" ? "Till payment matched. The sale is complete." : "M-Pesa payment matched. Your order has been placed successfully." });
  // A unique till payment now completes the sale on its own, so the only reason a
  // seller is still asked to choose is genuine ambiguity: several people paid the same
  // amount in the same few minutes and nothing but the payer name separates them.
  const amountCandidates = channel === "POS" ? await findRecentIncomingAmountCandidates(transaction.id) : [];
  if (receiptNumber) void requestKnownTransactionStatus(transaction.id).catch((error) => console.warn("Transaction Status request could not be started", { transactionId: transaction.id, error }));
  return json({ ok: true, paid:false, candidatePayment:null, candidatePayments:amountCandidates.map(incomingCandidatePayload), orderNumber: order.orderNumber, message: amountCandidates.length > 1 ? `${amountCandidates.length} Till payments have this exact amount. Ask the customer for the payer name or receipt and choose the correct payment.` : receiptNumber ? "Receipt extracted. Healthfield is checking Safaricom before sending it for review." : "Waiting for the till payment. It completes automatically the moment Safaricom delivers it." }, { status: 202 });
}

async function finalizeCancellation(orderId: number, paymentId: number, actorId: number | null) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, paymentId)).limit(1).for("update");
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    if (!payment || !order || payment.status !== "CANCEL_REQUESTED" || order.paymentStatus === "PAID") return false;
    const [paidComponent] = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "PAID"), ne(paymentTransactions.id, payment.id))).limit(1);
    if (paidComponent) {
      await tx.update(paymentTransactions).set({ status: "REQUIRES_REVIEW", resultDescription: "Cancellation blocked because another split-payment component is already paid." }).where(eq(paymentTransactions.id, payment.id));
      await tx.update(orders).set({ status: "UNDER_REVIEW", paymentStatus: "PENDING" }).where(eq(orders.id, order.id));
      await tx.insert(activityLogs).values({ actorId, action: "SPLIT_PAYMENT_CANCELLATION_BLOCKED", entityType: "order", entityId: String(order.id), metadata: { paymentId: payment.id, paidComponentId: paidComponent.id } });
      return false;
    }
    const items = await tx.select({ id: orderItems.id, productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, order.id));
    const fulfilments = items.length ? await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [];
    for (const fulfilment of fulfilments) {
      const item = items.find((entry) => entry.id === fulfilment.orderItemId);
      if (!item?.productId || fulfilment.quantityReserved <= 0) continue;
      const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, fulfilment.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
      if (stock) await tx.update(branchInventory).set({ quantityReserved: Math.max(0, stock.quantityReserved - fulfilment.quantityReserved), updatedBy: actorId }).where(eq(branchInventory.id, stock.id));
      await tx.update(orderItemFulfilments).set({ quantityReserved: 0, status: "UNAVAILABLE" }).where(eq(orderItemFulfilments.id, fulfilment.id));
    }
    await tx.update(paymentTransactions).set({ status: "CANCELLED", resultDescription: "Counter sale cancelled after the payment reconciliation window." }).where(eq(paymentTransactions.id, payment.id));
    await tx.update(orders).set({ status: "CANCELLED", paymentStatus: "FAILED" }).where(eq(orders.id, order.id));
    await tx.insert(activityLogs).values({ actorId, action: "WALK_IN_SALE_CANCELLED", entityType: "order", entityId: String(order.id), metadata: { orderNumber: order.orderNumber, paymentId: payment.id } });
    return true;
  });
}

export async function finalizeExpiredPaymentCancellations() {
  const db = getDb();
  const expired = await db.select({ id: paymentTransactions.id, orderId: paymentTransactions.orderId, actorId: paymentTransactions.reviewedBy }).from(paymentTransactions).where(and(eq(paymentTransactions.status, "CANCEL_REQUESTED"), lte(paymentTransactions.updatedAt, new Date(Date.now() - cancellationGraceMs)))).limit(50);
  let finalized = 0;
  for (const payment of expired) if (await finalizeCancellation(payment.orderId, payment.id, payment.actorId)) finalized += 1;
  return finalized;
}

export async function handlePaymentReconcile(request: Request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { checkoutToken?: string } | null;
  const checkoutToken = input?.checkoutToken || "";
  const status = await paymentStatus(checkoutToken);
  if (!status?.payment) return json({ error: "Payment request not found." }, { status: 404 });
  if (status.order.paymentStatus === "PAID") return json({ ok: true, paid: true, ...status });
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, status.payment.id)).limit(1);
  if (payment.method === "MANUAL_MPESA") {
    const matched = await reconcileManualPaymentFromIncoming(payment.id);
    if (matched.paid) return json({ ok:true, paid:true, message: payment.channel === "POS" ? "Till payment matched. The sale is complete." : "M-Pesa receipt matched. Your order has been placed successfully.", ...(await paymentStatus(checkoutToken)) });
    if (payment.channel === "POS") {
      // A single unambiguous till payment settles itself above, so reaching here means
      // either several payers used the same amount, or the automatic completion was
      // refused. Either way the seller is offered the list rather than left waiting.
      const amountCandidates = await findRecentIncomingAmountCandidates(payment.id);
      if (amountCandidates.length) return json({ ok:true, paid:false, candidatePayments:amountCandidates.map(incomingCandidatePayload), message:amountCandidates.length === 1 ? "A Till payment matching this amount needs checking. Confirm the payer name with the customer." : `${amountCandidates.length} Till payments have this exact amount. Ask the customer for the payer name or receipt and choose the correct payment.`, ...(await paymentStatus(checkoutToken)) });
    }
    if (payment.channel === "ONLINE" && payment.receiptNumber) void requestKnownTransactionStatus(payment.id).catch((error) => console.warn("Transaction Status request could not be started", { transactionId: payment.id, error }));
    if (payment.status === "CANCEL_REQUESTED" && Date.now() - payment.updatedAt.getTime() >= cancellationGraceMs) {
      const cancelled = await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
      return json({ ok: true, paid: false, cancelled, message: "No Till payment was found. The counter sale has been cancelled.", ...(await paymentStatus(checkoutToken)) });
    }
    return json({ ok: true, paid: false, cancellationRequested: payment.status === "CANCEL_REQUESTED", ...(await paymentStatus(checkoutToken)) });
  }
  if (!payment.checkoutRequestId) return json({ error: payment.resultDescription || "M-Pesa Express was not started.", code: "MPESA_NOT_STARTED" }, { status: 409 });
  // Daraja may acknowledge an STK request before it becomes queryable. The
  // secret-protected notification route is authoritative, so do not query in that gap.
  if (Date.now() - payment.createdAt.getTime() < 10_000) {
    return json({ ok: true, paid: false, message: "Payment prompt sent. Waiting for the phone response.", ...status }, { status: 202 });
  }
  try {
    const result = await throttledStkQuery(payment.checkoutRequestId);
    const outcome = classifyStkQueryResult(result);
    if (outcome.state === "PAID") {
      const receiptNumber = stkReconciliationReference(payment.checkoutRequestId, result.MpesaReceiptNumber || payment.receiptNumber);
      await markPaymentPaid(payment.id, { receiptNumber, amount: Number(payment.amount), phone: payment.phone, providerPayload: result });
      return json({ ok: true, paid: true, ...(await paymentStatus(checkoutToken)) });
    }
    if (outcome.state === "PENDING") {
      if (payment.status === "CANCEL_REQUESTED" && Date.now() - payment.updatedAt.getTime() >= cancellationGraceMs) {
        const cancelled = await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
        return json({ ok: true, paid: false, cancelled, message: "No successful M-Pesa response arrived. The counter sale has been cancelled.", ...(await paymentStatus(checkoutToken)) });
      }
      return json({ ok: true, paid: false, message: "Waiting for the payment response.", ...status }, { status: 202 });
    }
    if (payment.status === "CANCEL_REQUESTED") {
      await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
      return json({ ok: true, paid: false, cancelled: true, message: outcome.resultDescription || "M-Pesa payment was not completed.", ...(await paymentStatus(checkoutToken)) });
    }
    await db.update(paymentTransactions).set({ status: "FAILED", resultCode: outcome.resultCode, resultDescription: outcome.resultDescription || "M-Pesa payment was not completed.", providerPayload: result }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
    await markOrderPaymentAttemptFailed(payment.orderId);
    const latestStatus = await paymentStatus(checkoutToken);
    if (latestStatus?.order.paymentStatus === "PAID") return json({ ok: true, paid: true, ...latestStatus });
    return json({ ok: true, paid: false, failed: true, message: outcome.resultDescription || "M-Pesa payment was not completed.", ...latestStatus });
  } catch (error) {
    console.warn("STK status query is still pending", { transactionId: payment.id, message: error instanceof Error ? error.message : "Unknown provider response" });
    if (payment.status === "CANCEL_REQUESTED" && Date.now() - payment.updatedAt.getTime() >= cancellationGraceMs) {
      const cancelled = await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
      return json({ ok: true, paid: false, cancelled, message: "The reconciliation window ended without a successful confirmation.", ...(await paymentStatus(checkoutToken)) });
    }
    return json({ ok: true, paid: false, message: "Payment confirmation is still pending.", ...(await paymentStatus(checkoutToken)) }, { status: 202 });
  }
}

export async function reconcilePendingStkPayments() {
  if (stkBackgroundSweepRunning || !mpesaConfiguration()) return { checked: 0, paid: 0, failed: 0 };
  stkBackgroundSweepRunning = true;
  try {
    const db = getDb();
    const now = Date.now();
    for (const [paymentId, checkedAt] of stkBackgroundChecks) if (now - checkedAt > 25 * 60 * 60_000) stkBackgroundChecks.delete(paymentId);
    for (const [checkoutRequestId, query] of stkQueryCache) if (now - query.checkedAt > 10 * 60_000) stkQueryCache.delete(checkoutRequestId);
    const candidates = await db.select().from(paymentTransactions).where(and(
      eq(paymentTransactions.method, "MPESA_EXPRESS"),
      inArray(paymentTransactions.status, ["PENDING", "REQUIRES_REVIEW"]),
      gte(paymentTransactions.createdAt, new Date(now - 24 * 60 * 60_000)),
    )).orderBy(desc(paymentTransactions.createdAt)).limit(100);
    let checked = 0, paid = 0, failed = 0;
    for (const payment of candidates) {
      if (checked >= 4 || !payment.checkoutRequestId || now - payment.createdAt.getTime() < 10_000) continue;
      const lastCheckedAt = stkBackgroundChecks.get(payment.id) || 0;
      if (now - lastCheckedAt < stkBackgroundReconcileDelay(now - payment.createdAt.getTime())) continue;
      stkBackgroundChecks.set(payment.id, now);
      checked += 1;
      try {
        const result = await throttledStkQuery(payment.checkoutRequestId);
        const outcome = classifyStkQueryResult(result);
        if (outcome.state === "PAID") {
          const receiptNumber = stkReconciliationReference(payment.checkoutRequestId, result.MpesaReceiptNumber || payment.receiptNumber);
          await markPaymentPaid(payment.id, { receiptNumber, amount: Number(payment.amount), phone: payment.phone, providerPayload: result });
          paid += 1;
          console.info("Background STK reconciliation confirmed payment", { transactionId: payment.id, channel: payment.channel, checkoutRequestId: payment.checkoutRequestId });
        } else if (outcome.state === "FAILED") {
          await db.update(paymentTransactions).set({ status: "FAILED", resultCode: outcome.resultCode, resultDescription: outcome.resultDescription || "M-Pesa payment was not completed.", providerPayload: result }).where(and(eq(paymentTransactions.id, payment.id), inArray(paymentTransactions.status, ["PENDING", "REQUIRES_REVIEW"])));
          await markOrderPaymentAttemptFailed(payment.orderId);
          failed += 1;
        } else {
          await db.update(paymentTransactions).set({ resultCode: outcome.resultCode || payment.resultCode, resultDescription: outcome.resultDescription || payment.resultDescription, providerPayload: result }).where(and(eq(paymentTransactions.id, payment.id), inArray(paymentTransactions.status, ["PENDING", "REQUIRES_REVIEW"])));
        }
      } catch (error) {
        console.warn("Background STK reconciliation is still pending", { transactionId: payment.id, channel: payment.channel, message: error instanceof Error ? error.message : "Unknown provider response" });
      }
    }
    return { checked, paid, failed };
  } finally {
    stkBackgroundSweepRunning = false;
  }
}

export async function handlePaymentReview(request: Request, transactionId: number) {
  const auth = await requireTeamPermission(request, "PAYMENTS_REVIEW");
  if ("response" in auth) return auth.response;
  if (request.method !== "PATCH") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { decision?: "APPROVE" | "REJECT"; note?: string } | null;
  if (!input || !["APPROVE", "REJECT"].includes(input.decision || "")) return json({ error: "Choose approve or reject." }, { status: 400 });
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment) return json({ error: "Payment not found." }, { status: 404 });
  if (payment.status === "PAID") return json({ ok: true, message: "Payment is already approved." });
  if (input.decision === "APPROVE") {
    await markPaymentPaid(payment.id, { receiptNumber: payment.receiptNumber, amount: Number(payment.amount), phone: payment.phone, actorId: auth.session.userId });
  } else {
    const rejected = await db.transaction(async (tx) => {
      const [lockedPayment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, payment.id)).limit(1).for("update");
      const [lockedOrder] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1).for("update");
      if (!lockedPayment || !lockedOrder || lockedPayment.status === "PAID" || lockedOrder.paymentStatus === "PAID") return false;
      await tx.update(paymentTransactions).set({ status: "FAILED", reviewedBy: auth.session.userId, reviewedAt: new Date(), resultDescription: input.note?.trim() || "Payment proof rejected by administrator." }).where(eq(paymentTransactions.id, lockedPayment.id));
      const otherPaid = await tx.select({ amount: paymentTransactions.amount }).from(paymentTransactions).where(and(eq(paymentTransactions.orderId, lockedOrder.id), eq(paymentTransactions.status, "PAID"), ne(paymentTransactions.id, lockedPayment.id)));
      const otherPaidTotal = otherPaid.reduce((sum, row) => sum + Number(row.amount), 0);
      await tx.update(orders).set(otherPaidTotal > 0 ? { paymentStatus: "PENDING", status: "UNDER_REVIEW", amountPaid: otherPaidTotal.toFixed(2) } : { paymentStatus: "FAILED" }).where(eq(orders.id, lockedOrder.id));
      await tx.insert(activityLogs).values({ actorId:auth.session.userId, action:"PAYMENT_REJECTED", entityType:"order", entityId:String(lockedOrder.id), metadata:{ transactionId:lockedPayment.id, amount:lockedPayment.amount, actorRole:auth.session.role } });
      return true;
    });
    if (!rejected) return json({ error: "Safaricom confirmed this payment before the rejection completed. The order remains paid." }, { status: 409 });
  }
  return json({ ok: true });
}

export async function handlePaymentCancel(request: Request) {
  const auth = await requireSession(request, [...team]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { checkoutToken?: string } | null;
  const checkoutToken = input?.checkoutToken || "";
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.checkoutToken, checkoutToken)).limit(1);
  if (!order) return json({ error: "Pending counter sale not found." }, { status: 404 });
  const [latest] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
  if (!latest || latest.channel !== "POS") return json({ error: "Pending counter sale not found." }, { status: 404 });
  if (order.paymentStatus === "PAID") return json({ error: "A paid sale cannot be cancelled here." }, { status: 409 });
  const [paidComponent] = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, "PAID"))).limit(1);
  if (paidComponent) return json({ error: "This split sale already accepted part of the payment. Complete the remaining part or ask an administrator to process a refund; it cannot be silently cancelled." }, { status: 409 });
  if (latest.status === "REQUIRES_REVIEW" && latest.resultCode === "0") return json({ error: "Safaricom reports this payment as successful. It cannot be cancelled while the receipt is pending." }, { status: 409 });
  const reconciliation = await handlePaymentReconcile(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutToken }) }));
  const reconciliationData = await reconciliation.clone().json().catch(() => ({})) as { paid?: boolean; providerConfirmed?: boolean; candidatePayment?: unknown; order?: { paymentStatus?: string } };
  if (reconciliationData.paid || reconciliationData.order?.paymentStatus === "PAID") return json({ error: "Payment was confirmed while cancellation was requested. The sale has been completed." }, { status: 409 });
  if (reconciliationData.providerConfirmed) return json({ error: "Safaricom reports this payment as successful. It cannot be cancelled while the receipt is pending." }, { status: 409 });
  if (reconciliationData.candidatePayment) return json({ error: "A matching Till payment was found. Confirm the payer name with the customer before closing the sale." }, { status: 409 });
  const state = await db.transaction(async (tx) => {
    const [lockedPayment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, latest.id)).limit(1).for("update");
    const [lockedOrder] = await tx.select().from(orders).where(eq(orders.id, order.id)).limit(1).for("update");
    if (!lockedPayment || !lockedOrder) return "MISSING" as const;
    if (lockedPayment.status === "PAID" || lockedOrder.paymentStatus === "PAID") return "PAID" as const;
    if (lockedPayment.status === "REQUIRES_REVIEW" && lockedPayment.resultCode === "0") return "CONFIRMED" as const;
    await tx.update(paymentTransactions).set({ status: "CANCEL_REQUESTED", reviewedBy: auth.session.userId, reviewedAt: new Date(), resultDescription: "Cancellation requested; reconciling late M-Pesa confirmation before releasing stock." }).where(eq(paymentTransactions.id, lockedPayment.id));
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "WALK_IN_SALE_CANCELLATION_REQUESTED", entityType: "order", entityId: String(lockedOrder.id), metadata: { orderNumber: lockedOrder.orderNumber, paymentId: lockedPayment.id, graceSeconds: cancellationGraceMs / 1000 } });
    return "REQUESTED" as const;
  });
  if (state === "PAID") return json({ error: "Payment was confirmed while cancellation was requested. The sale has been completed." }, { status: 409 });
  if (state === "CONFIRMED") return json({ error: "Safaricom reports this payment as successful. Wait for the receipt confirmation." }, { status: 409 });
  if (state === "MISSING") return json({ error: "Pending counter sale not found." }, { status: 404 });
  return json({ ok: true, cancellationRequested: true, graceSeconds: cancellationGraceMs / 1000, message: "Cancellation requested. Healthfield will keep checking M-Pesa before releasing stock." }, { status: 202 });
}

export async function handleStkNotification(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseStkCallback(payload);
  if (!parsed.checkoutRequestId) return json({ ResultCode: 1, ResultDesc: "Invalid notification" }, { status: 400 });
  const db = getDb();
  let callbackId = 0;
  try { const [created] = await db.insert(mpesaStkCallbacks).values({ checkoutRequestId: parsed.checkoutRequestId, providerPayload: payload }); callbackId = created.insertId; }
  catch { const [existing] = await db.select({ id: mpesaStkCallbacks.id }).from(mpesaStkCallbacks).where(eq(mpesaStkCallbacks.checkoutRequestId, parsed.checkoutRequestId)).limit(1); callbackId = existing?.id || 0; }
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.checkoutRequestId, parsed.checkoutRequestId)).limit(1);
  if (!payment) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (payment.merchantRequestId && payment.merchantRequestId !== parsed.merchantRequestId) {
    console.warn("STK notification MerchantRequestID differs; CheckoutRequestID remains authoritative", { transactionId: payment.id, checkoutRequestId: parsed.checkoutRequestId });
  }
  let processed = true;
  if (parsed.resultCode === "0" && parsed.receiptNumber && parsed.amount !== null) {
    try { await markPaymentPaid(payment.id, { receiptNumber: parsed.receiptNumber, amount: parsed.amount, phone: parsed.phone, providerPayload: payload }); }
    catch (error) { processed = false; console.error("Mobile-money notification requires review", { transactionId: payment.id, error }); }
  } else {
    if (payment.status === "CANCEL_REQUESTED") await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
    else {
      await db.update(paymentTransactions).set({ status: "FAILED", resultCode: parsed.resultCode, resultDescription: parsed.resultDescription, providerPayload: payload }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
      await markOrderPaymentAttemptFailed(payment.orderId);
    }
  }
  if (callbackId && processed) await db.update(mpesaStkCallbacks).set({ processedTransactionId: payment.id }).where(eq(mpesaStkCallbacks.id, callbackId));
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function replayStoredStkCallback(checkoutRequestId: string) {
  const db = getDb();
  const [stored] = await db.select().from(mpesaStkCallbacks).where(and(eq(mpesaStkCallbacks.checkoutRequestId, checkoutRequestId), isNull(mpesaStkCallbacks.processedTransactionId))).limit(1);
  if (!stored) return false;
  const parsed = parseStkCallback(stored.providerPayload);
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.checkoutRequestId, checkoutRequestId)).limit(1);
  if (!payment) return false;
  if (parsed.resultCode === "0" && parsed.receiptNumber && parsed.amount !== null) await markPaymentPaid(payment.id, { receiptNumber: parsed.receiptNumber, amount: parsed.amount, phone: parsed.phone, providerPayload: stored.providerPayload });
  else {
    if (payment.status === "CANCEL_REQUESTED") await finalizeCancellation(payment.orderId, payment.id, payment.reviewedBy);
    else {
      await db.update(paymentTransactions).set({ status: "FAILED", resultCode: parsed.resultCode, resultDescription: parsed.resultDescription, providerPayload: stored.providerPayload }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
      await markOrderPaymentAttemptFailed(payment.orderId);
    }
  }
  await db.update(mpesaStkCallbacks).set({ processedTransactionId: payment.id }).where(eq(mpesaStkCallbacks.id, stored.id));
  return true;
}

async function ingestIncomingPayment(incoming: IncomingMpesaPayment, payload: Record<string, unknown>, source: "C2B" | "PULL" | "TRANSACTION_STATUS") {
  const db = getDb();
  let incomingId = 0;
  let isNewIncoming = false;
  try {
    const [created] = await db.insert(mpesaIncomingPayments).values({ ...incoming, amount: incoming.amount.toFixed(2), providerPayload: { ...payload, healthfieldRecoverySource: source } });
    incomingId = created.insertId;
    isNewIncoming = true;
  } catch {
    const [existing] = await db.select({ id: mpesaIncomingPayments.id }).from(mpesaIncomingPayments).where(eq(mpesaIncomingPayments.receiptNumber, incoming.receiptNumber)).limit(1);
    if (!existing) throw new Error("The incoming M-Pesa receipt could not be stored.");
    incomingId = existing.id;
  }
  if (isNewIncoming) {
    try {
      await db.insert(activityLogs).values({ actorId: null, action: "MPESA_TILL_PAYMENT_RECEIVED", entityType: "mpesa_incoming_payment", entityId: String(incomingId), metadata: { receiptNumber: incoming.receiptNumber, amount: incoming.amount, accountReference: incoming.accountReference, source } });
      const recipients = process.env.NOTIFICATION_EMAIL
        ? [process.env.NOTIFICATION_EMAIL]
        : (await db.select({ email: users.email }).from(users).where(and(inArray(users.role, ["ADMIN", "SUPER_ADMIN"]), eq(users.isActive, true)))).map((row) => row.email);
      const reference = incoming.accountReference || "No reference supplied";
      const payer = incoming.payerName || "Name not supplied";
      if (recipients.length) void sendEmail({
        to: [...new Set(recipients)],
        subject: `Till payment received · ${incoming.receiptNumber}`,
        message: `Safaricom delivered a new Till payment to Healthfield.\n\nReceipt: ${incoming.receiptNumber}\nAmount: KES ${incoming.amount.toLocaleString()}\nPayer: ${payer}\nReference: ${reference}\n\nOpen Unmatched payments if this receipt still needs an order match.`,
        action: { label: "Open Till payments", url: `${(process.env.APP_URL || "https://healthfieldpharmacy.co.ke").replace(/\/$/, "")}/admin/unmatched-payments` },
        channel: "orders",
      }).catch((error) => console.error("Till payment notification failed", { incomingId, error }));
    } catch (error) {
      console.error("Till payment admin notification could not be queued", { incomingId, error });
    }
  }
  const [receiptPayment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.receiptNumber, incoming.receiptNumber)).limit(1);
  let payment: typeof paymentTransactions.$inferSelect | undefined = receiptPayment?.method !== "CASH" ? receiptPayment : undefined;
  if (!payment) {
    // The database clock decides how recent a payment is, so a drift between the API
    // host and MySQL cannot quietly shrink the matching window to nothing.
    const candidateRows = await db.select({
      payment: paymentTransactions,
      orderNumber: orders.orderNumber,
      createdAtUnix: sql<number>`unix_timestamp(${paymentTransactions.createdAt})`,
      databaseNowUnix: sql<number>`unix_timestamp(current_timestamp)`,
    }).from(paymentTransactions).innerJoin(orders, eq(orders.id, paymentTransactions.orderId)).where(and(inArray(paymentTransactions.method, ["MPESA_EXPRESS", "MANUAL_MPESA"]), inArray(paymentTransactions.status, ["INITIATED", "PENDING", "CANCEL_REQUESTED", "REQUIRES_REVIEW", "PAID", "FAILED", "CANCELLED"]), sql`${paymentTransactions.createdAt} >= date_sub(current_timestamp, interval 24 hour)`)).orderBy(desc(paymentTransactions.createdAt)).limit(200);
    const now = candidateRows.length ? Number(candidateRows[0].databaseNowUnix) * 1000 : Date.now();
    const selected = selectPaymentForIncoming({
      incoming: { receiptNumber: incoming.receiptNumber, amount: incoming.amount, accountReference: incoming.accountReference },
      now,
      candidates: candidateRows.map((row) => ({
        id: row.payment.id,
        method: row.payment.method,
        channel: row.payment.channel,
        status: row.payment.status,
        amount: row.payment.amount,
        receiptNumber: row.payment.receiptNumber,
        createdAt: new Date(Number(row.createdAtUnix) * 1000),
        orderNumber: row.orderNumber,
        payment: row.payment,
      })),
    });
    payment = selected?.payment;
  }
  if (payment && Math.abs(Number(payment.amount) - incoming.amount) <= 0.001) {
    // The selector already refused anything ambiguous, so a counter sale that reaches
    // here has exactly one payment it can belong to and completes on its own. Holding
    // it for the seller to confirm was the step that left tills waiting.
    try {
      await markPaymentPaid(payment.id, { receiptNumber: incoming.receiptNumber, amount: incoming.amount, phone: incoming.phone, providerPayload: { ...payload, healthfieldRecoverySource: source }, incomingPaymentId: incomingId });
    } catch (error) { console.error("C2B payment match requires review", { transactionId: payment.id, error }); }
  }
  return { incomingId, isNewIncoming };
}

export async function handleC2bConfirmation(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const sourceIp = paymentProviderSource(request);
  try {
    const incoming = parseC2bPayment(payload);
    console.info("M-Pesa C2B confirmation received", { sourceIp, ...callbackSummary(payload, incoming.receiptNumber, incoming.amount) });
    const result = await ingestIncomingPayment(incoming, payload, "C2B");
    console.info("M-Pesa C2B confirmation accepted", { sourceIp, incomingPaymentId: result.incomingId, isNew: result.isNewIncoming, receiptSuffix: incoming.receiptNumber.slice(-4) });
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("M-Pesa C2B confirmation failed", { sourceIp, ...callbackSummary(payload), error });
    return json({ ResultCode: 1, ResultDesc: "Unable to process confirmation" }, { status: 500 });
  }
}

export async function handleC2bVerification(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const sourceIp = paymentProviderSource(request);
  try {
    const incoming = parseC2bPayment(payload);
    console.info("M-Pesa C2B verification accepted", { sourceIp, ...callbackSummary(payload, incoming.receiptNumber, incoming.amount) });
    return json({ ResultCode: "0", ResultDesc: "Accepted" });
  } catch (error) {
    console.warn("M-Pesa C2B verification rejected", { sourceIp, ...callbackSummary(payload), error: error instanceof Error ? error.message : "Invalid payload" });
    return json({ ResultCode: "C2B00012", ResultDesc: "Invalid transaction details" });
  }
}

export async function handlePullTransactionsNotification(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const sourceIp = paymentProviderSource(request);
  try {
    const transactions = parsePullTransactions(payload);
    let inserted = 0;
    for (const transaction of transactions) {
      const result = await ingestIncomingPayment(transaction, payload, "PULL");
      if (result.isNewIncoming) inserted += 1;
    }
    await getDb().insert(activityLogs).values({ actorId: null, action: "MPESA_PULL_CALLBACK_RECEIVED", entityType: "payment_recovery", entityId: null, metadata: { received: transactions.length, inserted } });
    console.info("M-Pesa Pull callback accepted", { sourceIp, received: transactions.length, inserted });
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("M-Pesa Pull callback failed", { sourceIp, error });
    return json({ ResultCode: 1, ResultDesc: "Unable to process recovery notification" }, { status: 500 });
  }
}

export async function handleTransactionStatusResult(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const result = parseTransactionStatusResult(payload);
  if (result.successful && result.payment) await ingestIncomingPayment(result.payment, payload, "TRANSACTION_STATUS");
  else if (result.receiptNumber || result.originatorConversationId) {
    const [payment] = await getDb().select().from(paymentTransactions).where(or(
      ...(result.receiptNumber ? [eq(paymentTransactions.receiptNumber, result.receiptNumber)] : []),
      ...(result.originatorConversationId ? [eq(paymentTransactions.merchantRequestId, result.originatorConversationId)] : []),
    )).limit(1);
    if (payment && payment.status !== "PAID") await getDb().update(paymentTransactions).set({ status: "REQUIRES_REVIEW", resultCode: result.resultCode, resultDescription: result.resultDescription || "Safaricom Transaction Status requires administrator review.", providerPayload: payload }).where(eq(paymentTransactions.id, payment.id));
  }
  await getDb().insert(activityLogs).values({ actorId: null, action: "MPESA_TRANSACTION_STATUS_RESULT", entityType: "payment_recovery", entityId: result.receiptNumber || result.originatorConversationId, metadata: { resultCode: result.resultCode, resultDescription: result.resultDescription, hasPaymentDetails: Boolean(result.payment) } });
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function handleTransactionStatusTimeout(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  await getDb().insert(activityLogs).values({ actorId: null, action: "MPESA_TRANSACTION_STATUS_TIMEOUT", entityType: "payment_recovery", entityId: null, metadata: { payload } });
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function handleIncomingPaymentMatch(request: Request, incomingId: number) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { orderReference?: string } | null;
  const orderReference = (input?.orderReference || "").trim().toUpperCase();
  if (!orderReference || orderReference.length > 40) return json({ error: "Enter the exact Healthfield order reference." }, { status: 400 });
  const db = getDb();
  const [incoming] = await db.select().from(mpesaIncomingPayments).where(and(eq(mpesaIncomingPayments.id, incomingId), isNull(mpesaIncomingPayments.matchedTransactionId))).limit(1);
  if (!incoming) return json({ error: "This incoming payment was not found or is already matched." }, { status: 404 });
  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderReference)).limit(1);
  if (!order) return json({ error: "No order has that reference." }, { status: 404 });
  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") return json({ error: "That order is already paid or refunded." }, { status: 409 });
  if (Math.abs(Number(order.total) - Number(incoming.amount)) > 0.001) return json({ error: `Amount mismatch: the payment is KES ${Number(incoming.amount).toLocaleString()} but ${order.orderNumber} requires KES ${Number(order.total).toLocaleString()}.` }, { status: 409 });
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
  if (!payment || payment.method === "CASH") return json({ error: "That order has no compatible M-Pesa payment attempt." }, { status: 409 });
  const result = await markPaymentPaid(payment.id, { receiptNumber: incoming.receiptNumber, amount: Number(incoming.amount), phone: incoming.phone, providerPayload: incoming.providerPayload || undefined, actorId: auth.session.userId, incomingPaymentId: incoming.id });
  return json({ ok: true, orderId: order.id, orderNumber: order.orderNumber, inventoryFinalized: result.inventoryFinalized, message: result.inventoryFinalized ? "Payment matched and the sale was completed." : "Payment matched. The order is paid and requires fulfilment review because its stock had been released." });
}

export async function handlePosIncomingPaymentConfirm(request: Request, incomingId: number) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const input = await request.json().catch(() => null) as { checkoutToken?:string } | null;
  const checkoutToken=(input?.checkoutToken||"").trim();
  const db=getDb();
  const [order]=await db.select().from(orders).where(eq(orders.checkoutToken,checkoutToken)).limit(1);
  if(!order)return json({error:"Counter sale not found."},{status:404});
  const [payment]=await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId,order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
  if(!payment||payment.channel!=="POS")return json({error:"Counter sale not found."},{status:404});
  if(auth.session.role==="STAFF"&&auth.session.homeBranchId!==order.suggestedBranchId)return json({error:"This sale belongs to another shop."},{status:403});
  if(order.paymentStatus==="PAID")return json({ok:true,paid:true,orderNumber:order.orderNumber,receiptNumber:order.paymentReference});
  if(payment.method!=="MANUAL_MPESA")return json({error:"This is not a Till payment sale."},{status:409});
  const [candidateRow]=await db.select({
    ...getTableColumns(mpesaIncomingPayments),
    createdAtUnix:sql<number>`unix_timestamp(${mpesaIncomingPayments.createdAt})`,
    databaseNowUnix:sql<number>`unix_timestamp(current_timestamp)`,
  }).from(mpesaIncomingPayments).where(and(eq(mpesaIncomingPayments.id,incomingId),isNull(mpesaIncomingPayments.matchedTransactionId))).limit(1);
  if(!candidateRow)return json({error:"That Till receipt is no longer available. Review it in Unmatched payments."},{status:409});
  const {createdAtUnix,databaseNowUnix,...candidate}=candidateRow;
  const ageSeconds=Number(databaseNowUnix)-Number(createdAtUnix);
  const exactSubmittedReceipt=Boolean(payment.receiptNumber&&payment.receiptNumber===candidate.receiptNumber);
  if(Math.abs(Number(payment.amount)-Number(candidate.amount))>0.001||(!exactSubmittedReceipt&&(ageSeconds<0||ageSeconds>30*60)))return json({error:"That payment is not a recent exact-amount match for this sale. Review it in Unmatched payments."},{status:409});
  const result=await markPaymentPaid(payment.id,{receiptNumber:candidate.receiptNumber,amount:Number(candidate.amount),phone:candidate.phone,providerPayload:candidate.providerPayload||undefined,actorId:auth.session.userId,incomingPaymentId:candidate.id});
  return json({ok:true,paid:true,orderNumber:order.orderNumber,receiptNumber:candidate.receiptNumber,inventoryFinalized:result.inventoryFinalized,message:result.inventoryFinalized?"Customer identity confirmed. Payment recorded and stock updated.":"Payment recorded. The order requires fulfilment review because reserved stock was no longer available."});
}

export async function requestKnownTransactionStatus(transactionId: number) {
  if (!transactionStatusConfiguration()) return { requested: false, reason: "not-configured" as const };
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment?.receiptNumber || payment.method !== "MANUAL_MPESA" || payment.status === "PAID" || payment.status === "REFUNDED") return { requested: false, reason: "not-queryable" as const };
  const [recent] = await db.select({ id: activityLogs.id }).from(activityLogs).where(and(eq(activityLogs.action, "MPESA_TRANSACTION_STATUS_REQUESTED"), eq(activityLogs.entityType, "payment_transaction"), eq(activityLogs.entityId, String(payment.id)), gte(activityLogs.createdAt, new Date(Date.now() - 30 * 60_000)))).orderBy(desc(activityLogs.createdAt)).limit(1);
  if (recent) return { requested: false, reason: "throttled" as const };
  await db.insert(activityLogs).values({ actorId: null, action: "MPESA_TRANSACTION_STATUS_REQUESTED", entityType: "payment_transaction", entityId: String(payment.id), metadata: { receiptNumber: payment.receiptNumber } });
  const response = await queryTransactionStatus(payment.receiptNumber);
  const originatorConversationId = String(response.OriginatorConversationID || "").trim() || null;
  await db.update(paymentTransactions).set({ merchantRequestId: originatorConversationId || payment.merchantRequestId, resultDescription: "Safaricom Transaction Status request accepted; waiting for the result callback.", providerPayload: response }).where(and(eq(paymentTransactions.id, payment.id), inArray(paymentTransactions.status, ["PENDING", "REQUIRES_REVIEW", "FAILED", "CANCELLED"])));
  return { requested: true, response };
}

export async function recoverMissedMpesaPayments(actorId: number | null = null, hours = 2) {
  if (!pullTransactionsConfiguration()) return { requested: false, configured: false, message: "M-Pesa Pull Transactions is not configured." };
  const db = getDb();
  // Compare both timestamps inside MySQL. Parsing a Nairobi database timestamp
  // with a UTC Node process can otherwise make a ten-minute cooldown look like
  // a three-hour cooldown.
  const [recent] = await db.select({
    requestedAtUnix: sql<number>`unix_timestamp(${activityLogs.createdAt})`,
    databaseNowUnix: sql<number>`unix_timestamp(current_timestamp)`,
  }).from(activityLogs).where(eq(activityLogs.action, "MPESA_PULL_QUERY_REQUESTED")).orderBy(desc(activityLogs.createdAt)).limit(1);
  const throttleSeconds = Math.ceil(pullRecoveryThrottleMs / 1000);
  const elapsedSeconds = recent ? Number(recent.databaseNowUnix) - Number(recent.requestedAtUnix) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(elapsedSeconds) && elapsedSeconds < throttleSeconds) {
    const retryAfterSeconds = Math.max(1, throttleSeconds - Math.max(0, Math.trunc(elapsedSeconds)));
    return { requested: false, configured: true, throttled: true, retryAfterSeconds, message: `A Till recovery check already ran recently. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).` };
  }
  const end = new Date();
  const boundedHours = Math.min(24, Math.max(1, Math.trunc(hours)));
  const start = new Date(end.getTime() - boundedHours * 60 * 60_000);
  await db.insert(activityLogs).values({ actorId, action: "MPESA_PULL_QUERY_REQUESTED", entityType: "payment_recovery", entityId: null, metadata: { start: start.toISOString(), end: end.toISOString(), hours: boundedHours } });
  const response = await queryPulledTransactions(start, end, 0);
  const transactions = parsePullTransactions(response);
  let inserted = 0;
  for (const transaction of transactions) {
    const result = await ingestIncomingPayment(transaction, response, "PULL");
    if (result.isNewIncoming) inserted += 1;
  }
  await db.insert(activityLogs).values({ actorId, action: "MPESA_PULL_QUERY_COMPLETED", entityType: "payment_recovery", entityId: null, metadata: { received: transactions.length, inserted, responseCode: String(response.ResponseCode ?? "") } });
  return { requested: true, configured: true, received: transactions.length, inserted, message: transactions.length ? `Recovered ${transactions.length} Till transaction(s); ${inserted} were new.` : "Safaricom accepted the recovery check. Any asynchronous results will appear here when delivered." };
}

export async function handlePullTransactionsRecovery(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  try {
    const result = await recoverMissedMpesaPayments(auth.session.userId, 24);
    return json({ ok: result.requested || result.throttled, ...result }, { status: result.configured === false ? 409 : result.throttled ? 429 : 202, headers: result.throttled ? { "Retry-After": String(result.retryAfterSeconds) } : undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Safaricom could not complete the Till recovery check.";
    return json({ error: message }, { status: 409 });
  }
}

/**
 * Registers the Till callback URLs with Safaricom.
 *
 * This is the step that makes C2B work at all, and it is not a deploy artefact: the
 * endpoints answer whether or not Safaricom knows about them. It lives behind an admin
 * action rather than only a shell script because the API runs as a prebuilt bundle on
 * shared hosting, where nobody has a terminal when a payment stops arriving.
 */
export async function handleC2bRegistration(request: Request) {
  const auth = await requireSession(request, [...admins]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  try {
    const result = await registerC2bUrls();
    await getDb().insert(activityLogs).values({
      actorId: auth.session.userId,
      action: "MPESA_C2B_URLS_REGISTERED",
      entityType: "payment_configuration",
      entityId: null,
      // The secret is the last path segment of both URLs, so only the shape is stored.
      metadata: { shortcode: result.shortcode, version: result.version, originatorConversationId: result.originatorConversationId, responseCode: result.responseCode, responseDescription: result.responseDescription, actorRole: auth.session.role },
    });
    return json({
      ok: true,
      message: `${result.responseDescription} Registered on the ${result.version} API for shortcode ${result.shortcode}; Safaricom will now post Till payments to this portal.`,
      responseCode: result.responseCode,
      shortcode: result.shortcode,
      originatorConversationId: result.originatorConversationId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Safaricom did not register the callback URLs.";
    console.error("M-Pesa C2B registration failed", { error });
    return json({ error: message }, { status: 409 });
  }
}

export function paymentConfigurationSummary() {
  const config = mpesaConfiguration();
  return {
    mpesaConfigured: Boolean(config),
    stkQueryConfigured: Boolean(config),
    // Credentials being present is not the same as Safaricom knowing where to post.
    // This is only the first half; c2bRegistrationState() reports the half that
    // decides whether a Till payment ever arrives.
    c2bCallbacksConfigured: Boolean(config),
    transactionStatusConfigured: Boolean(transactionStatusConfiguration()),
    pullTransactionsConfigured: Boolean(pullTransactionsConfiguration()),
  };
}

/**
 * What the portal needs in order to say why Till payments are or are not arriving.
 *
 * Every automatic route into the portal is listed with the reason it is off, because
 * "M-Pesa is configured" was the only thing shown before and it is true even when no
 * payment can possibly be delivered.
 */
export async function c2bRegistrationState() {
  const config = mpesaConfiguration();
  const [registration] = config
    ? await getDb().select({ createdAt: activityLogs.createdAt, metadata: activityLogs.metadata })
        .from(activityLogs)
        .where(eq(activityLogs.action, "MPESA_C2B_URLS_REGISTERED"))
        .orderBy(desc(activityLogs.createdAt))
        .limit(1)
    : [];
  const urls = config ? buildC2bCallbackUrls(config.callbackBaseUrl, config.callbackSecret) : null;
  // Safaricom silently declines to call URLs containing certain words, so the screen
  // says so rather than leaving a registered-but-dead callback looking healthy.
  const forbidden = urls ? forbiddenCallbackWord(urls.confirmationUrl, urls.validationUrl) : null;
  const hidden = (url: string) => url.replace(/\/[^/]+$/, "/…");
  // Read exactly what pullTransactionsConfiguration() branches on, so the screen can
  // name the half that is wrong instead of repeating the setup instructions. Only
  // shapes leave the server: a flag, and how many digits the number has.
  const pullEnabled = process.env.MPESA_PULL_ENABLED?.trim().toLowerCase() === "true";
  const pullDigits = (process.env.MPESA_PULL_NOMINATED_NUMBER || "").replace(/\D/g, "");
  return {
    forbiddenCallbackWord: forbidden,
    pullEnabled,
    pullNumberDigits: pullDigits.length,
    pullNumberValid: /^254[17]\d{8}$/.test(pullDigits),
    mpesaConfigured: Boolean(config),
    shortcode: config ? process.env.MPESA_C2B_SHORTCODE?.trim() || config.shortcode : null,
    confirmationUrl: urls ? hidden(urls.confirmationUrl) : null,
    validationUrl: urls ? hidden(urls.validationUrl) : null,
    registeredAt: registration?.createdAt ? new Date(registration.createdAt).toISOString() : null,
    registrationResponse: registration ? String((registration.metadata as Record<string, unknown> | null)?.responseDescription ?? "") : null,
    registrationReference: registration ? String((registration.metadata as Record<string, unknown> | null)?.originatorConversationId ?? "") || null : null,
    pullConfigured: Boolean(pullTransactionsConfiguration()),
    transactionStatusConfigured: Boolean(transactionStatusConfiguration()),
  };
}
