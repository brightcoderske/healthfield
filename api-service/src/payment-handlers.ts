import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { activityLogs, branchInventory, mpesaIncomingPayments, mpesaStkCallbacks, orderItemFulfilments, orderItems, orders, paymentTransactions, siteSettings } from "../../db/schema";
import { requestSession, requireSession } from "./auth";
import { requireTeamPermission } from "./staff-permissions";
import { getDb } from "./db";
import { json } from "./http";
import { classifyStkQueryResult, extractMpesaReceipt, initiateStkPush, mpesaConfiguration, parseC2bPayment, parseStkCallback, queryStkPush } from "./mpesa";
import { queuePaidOrderNotification } from "./order-notifications";

const team = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;
type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function finalizePosInventory(tx: DatabaseTransaction, orderId: number, actorId: number | null) {
  const items = await tx.select({ id: orderItems.id, productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const relevant = items.length ? await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [];
  for (const item of items) {
    const fulfilment = relevant.find((row) => row.orderItemId === item.id);
    if (!fulfilment || item.productId === null) throw new Error(`Stock allocation is missing for ${item.productName}.`);
    const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, fulfilment.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
    if (!stock || stock.quantityAvailable < item.quantity || stock.quantityReserved < item.quantity) throw new Error(`Reserved stock is unavailable for ${item.productName}.`);
    await tx.update(branchInventory).set({ quantityAvailable: stock.quantityAvailable - item.quantity, quantityReserved: stock.quantityReserved - item.quantity, updatedBy: actorId }).where(eq(branchInventory.id, stock.id));
    await tx.update(orderItemFulfilments).set({ quantityPacked: item.quantity, status: "READY" }).where(eq(orderItemFulfilments.id, fulfilment.id));
  }
}

async function markPaymentPaid(transactionId: number, details: { receiptNumber: string | null; amount: number; phone?: string | null; providerPayload?: Record<string, unknown>; actorId?: number | null }) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1).for("update");
    if (!payment) throw new Error("Payment record not found.");
    if (payment.status === "PAID") return { orderId: payment.orderId, newlyPaid: false };
    if (Math.abs(Number(payment.amount) - details.amount) > 0.001) {
      await tx.update(paymentTransactions).set({ status: "REQUIRES_REVIEW", resultDescription: "The paid amount does not match the order total.", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
      throw new Error("The paid amount does not match the order total.");
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1).for("update");
    if (!order) throw new Error("Order not found.");
    if (order.paymentStatus === "PAID") {
      await tx.update(paymentTransactions).set({ status: "CANCELLED", resultDescription: "Another payment attempt already completed this order." }).where(eq(paymentTransactions.id, payment.id));
      return { orderId: order.id, newlyPaid: false };
    }
    if (payment.channel === "POS") await finalizePosInventory(tx, order.id, details.actorId ?? null);
    const paidAt = new Date();
    await tx.update(paymentTransactions).set({ status: "PAID", receiptNumber: details.receiptNumber, phone: details.phone || payment.phone, verifiedAt: paidAt, reviewedBy: details.actorId ?? payment.reviewedBy, reviewedAt: details.actorId ? paidAt : payment.reviewedAt, resultCode: "0", resultDescription: "Payment confirmed", providerPayload: details.providerPayload }).where(eq(paymentTransactions.id, payment.id));
    const paidOrderStatus = payment.channel === "POS" ? "COMPLETED" : ["NEW", "AWAITING_PAYMENT"].includes(order.status) ? "CONFIRMED" : order.status;
    await tx.update(orders).set({ paymentStatus: "PAID", paymentReference: details.receiptNumber, amountPaid: details.amount.toFixed(2), status: paidOrderStatus }).where(eq(orders.id, order.id));
    await tx.insert(activityLogs).values({ actorId: details.actorId ?? null, action: "PAYMENT_CONFIRMED", entityType: "order", entityId: String(order.id), metadata: { transactionId: payment.id, method: payment.method, receiptNumber: details.receiptNumber, amount: details.amount } });
    return { orderId: order.id, newlyPaid: true };
  });
  if (result.newlyPaid) queuePaidOrderNotification(result.orderId);
  return result.orderId;
}

function paymentPhone(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

async function matchIncomingPayment(transactionId: number) {
  const db = getDb();
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, transactionId)).limit(1);
  if (!payment || payment.method !== "MANUAL_MPESA" || payment.status !== "PENDING") return false;
  const [order] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  const recent = await db.select().from(mpesaIncomingPayments).where(and(isNull(mpesaIncomingPayments.matchedTransactionId), gte(mpesaIncomingPayments.createdAt, new Date(Date.now() - 30 * 60_000)))).orderBy(desc(mpesaIncomingPayments.createdAt)).limit(40);
  const amountMatches = recent.filter((row) => Math.abs(Number(row.amount) - Number(payment.amount)) <= 0.001);
  const receiptMatch = payment.receiptNumber ? amountMatches.find((row) => row.receiptNumber === payment.receiptNumber) : null;
  const referenceMatch = order ? amountMatches.find((row) => row.accountReference?.toUpperCase() === order.orderNumber.toUpperCase()) : null;
  const normalized = paymentPhone(payment.phone);
  const phoneMatches = normalized ? amountMatches.filter((row) => paymentPhone(row.phone) === normalized) : [];
  const incoming = receiptMatch || referenceMatch || (phoneMatches.length === 1 ? phoneMatches[0] : null) || (!normalized && amountMatches.length === 1 ? amountMatches[0] : null);
  if (!incoming) return false;
  await markPaymentPaid(payment.id, { receiptNumber: incoming.receiptNumber, amount: Number(incoming.amount), phone: incoming.phone, providerPayload: incoming.providerPayload || undefined });
  await db.update(mpesaIncomingPayments).set({ matchedTransactionId: payment.id }).where(and(eq(mpesaIncomingPayments.id, incoming.id), isNull(mpesaIncomingPayments.matchedTransactionId)));
  return true;
}

async function paymentStatus(checkoutToken: string) {
  const db = getDb();
  const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, paymentStatus: orders.paymentStatus, paymentMethod: orders.paymentMethod, paymentReference: orders.paymentReference, amountPaid: orders.amountPaid, total: orders.total }).from(orders).where(eq(orders.checkoutToken, checkoutToken)).limit(1);
  if (!order) return null;
  const [payment] = await db.select({ id: paymentTransactions.id, method: paymentTransactions.method, status: paymentTransactions.status, resultDescription: paymentTransactions.resultDescription, receiptNumber: paymentTransactions.receiptNumber, updatedAt: paymentTransactions.updatedAt }).from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
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

  const isPos = candidate.orderNumber.startsWith("POS-");
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
  try {
    paymentId = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, candidate.id)).limit(1).for("update");
      if (!order) throw new PaymentRetryError("Order not found.", 404);
      if (order.paymentStatus === "PAID") throw new PaymentRetryError("This order is already paid.");
      if (order.status === "CANCELLED" || order.paymentStatus === "REFUNDED") throw new PaymentRetryError("This order cannot be paid again.");
      if (order.paymentStatus !== "FAILED") throw new PaymentRetryError("A payment attempt is already active for this order.");
      const [latest] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
      if (latest && ["INITIATED", "PENDING", "REQUIRES_REVIEW"].includes(latest.status)) throw new PaymentRetryError("A payment attempt is already active for this order.");
      const [created] = await tx.insert(paymentTransactions).values({ orderId: order.id, method: "MPESA_EXPRESS", channel: isPos ? "POS" : "ONLINE", status: "INITIATED", amount: order.total, phone });
      await tx.update(orders).set({ checkoutToken: nextToken, paymentMethod: "MPESA_EXPRESS", paymentStatus: "PENDING", paymentReference: null }).where(eq(orders.id, order.id));
      await tx.insert(activityLogs).values({ actorId: session?.userId ?? null, action: "PAYMENT_RETRIED", entityType: "order", entityId: String(order.id), metadata: { transactionId: created.insertId, channel: isPos ? "POS" : "ONLINE" } });
      return created.insertId;
    });
  } catch (error) {
    if (error instanceof PaymentRetryError) return json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const stk = await initiateStkPush({ orderNumber: candidate.orderNumber, phone, amount: Number(candidate.total) });
    await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, paymentId));
    await replayStoredStkCallback(stk.checkoutRequestId);
    const status = await paymentStatus(nextToken);
    return json({ ok: true, checkoutToken: nextToken, paymentStatus: status?.order.paymentStatus || "PENDING", message: stk.customerMessage, ...status }, { status: status?.order.paymentStatus === "PAID" ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "M-Pesa Express could not start.";
    await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: message }).where(eq(paymentTransactions.id, paymentId));
    await db.update(orders).set({ paymentStatus: "FAILED" }).where(and(eq(orders.id, candidate.id), eq(orders.paymentStatus, "PENDING")));
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
  const channel = order.orderNumber.startsWith("POS-") ? "POS" : "ONLINE";
  if (channel === "ONLINE" && message.length < 10) return json({ error: "Paste the complete M-Pesa payment message." }, { status: 400 });
  const receiptNumber = message ? extractMpesaReceipt(message) : null;
  if (channel === "POS" ? settings?.posManualEnabled === false : settings?.onlineManualEnabled === false) return json({ error: "Manual M-Pesa payment is currently unavailable." }, { status: 409 });
  if (order.paymentStatus === "PAID") return json({ ok: true, paid: true, orderNumber: order.orderNumber });
  let transaction: typeof paymentTransactions.$inferSelect;
  try {
    if (channel === "POS") {
      const [existing] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)).limit(1);
      if (!existing) return json({ error: "Payment request not found." }, { status: 404 });
      await db.update(paymentTransactions).set({ method: "MANUAL_MPESA", status: "PENDING", receiptNumber: null, manualMessage: null, checkoutRequestId: null, merchantRequestId: null, resultCode: null, resultDescription: "Waiting for automatic till confirmation." }).where(eq(paymentTransactions.id, existing.id));
      [transaction] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, existing.id)).limit(1);
    } else {
      const [created] = await db.insert(paymentTransactions).values({ orderId: order.id, method: "MANUAL_MPESA", channel, status: "REQUIRES_REVIEW", amount: order.total, phone: order.phone, receiptNumber, manualMessage: message });
      [transaction] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, created.insertId)).limit(1);
    }
  } catch {
    return json({ error: "That M-Pesa code has already been submitted for another payment." }, { status: 409 });
  }
  await db.update(orders).set({ paymentMethod: "MANUAL_MPESA", paymentStatus: "PENDING", paymentReference: receiptNumber }).where(eq(orders.id, order.id));
  const paid = await matchIncomingPayment(transaction.id);
  return json({ ok: true, paid, orderNumber: order.orderNumber, message: paid ? "Payment verified automatically." : channel === "ONLINE" ? "Payment proof submitted for administrator approval." : "Waiting for the till payment. This sale will complete automatically when M-Pesa confirms it." }, { status: paid ? 200 : 202 });
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
    const paid = await matchIncomingPayment(payment.id);
    return json({ ok: true, paid, ...(await paymentStatus(checkoutToken)) });
  }
  if (!payment.checkoutRequestId) return json({ error: payment.resultDescription || "M-Pesa Express was not started.", code: "MPESA_NOT_STARTED" }, { status: 409 });
  // Daraja may acknowledge an STK request before it becomes queryable. The
  // secret-protected notification route is authoritative, so do not query in that gap.
  if (Date.now() - payment.createdAt.getTime() < 10_000) {
    return json({ ok: true, paid: false, message: "Payment prompt sent. Waiting for the phone response.", ...status }, { status: 202 });
  }
  try {
    const result = await queryStkPush(payment.checkoutRequestId);
    const outcome = classifyStkQueryResult(result);
    if (outcome.state === "PAID") {
      const receiptNumber = String(result.MpesaReceiptNumber || payment.receiptNumber || "");
      if (!receiptNumber) return json({ ok: true, paid: false, message: "M-Pesa approved the request; waiting for the receipt callback." }, { status: 202 });
      await markPaymentPaid(payment.id, { receiptNumber, amount: Number(payment.amount), phone: payment.phone, providerPayload: result });
      return json({ ok: true, paid: true, ...(await paymentStatus(checkoutToken)) });
    }
    if (outcome.state === "PENDING") {
      return json({ ok: true, paid: false, message: "Waiting for the payment response.", ...status }, { status: 202 });
    }
    await db.update(paymentTransactions).set({ status: "FAILED", resultCode: outcome.resultCode, resultDescription: outcome.resultDescription || "M-Pesa payment was not completed.", providerPayload: result }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
    await db.update(orders).set({ paymentStatus: "FAILED" }).where(and(eq(orders.id, payment.orderId), eq(orders.paymentStatus, "PENDING")));
    const latestStatus = await paymentStatus(checkoutToken);
    if (latestStatus?.order.paymentStatus === "PAID") return json({ ok: true, paid: true, ...latestStatus });
    return json({ ok: true, paid: false, failed: true, message: outcome.resultDescription || "M-Pesa payment was not completed.", ...latestStatus });
  } catch (error) {
    console.warn("STK status query is still pending", { transactionId: payment.id, message: error instanceof Error ? error.message : "Unknown provider response" });
    return json({ ok: true, paid: false, message: "Payment confirmation is still pending.", ...(await paymentStatus(checkoutToken)) }, { status: 202 });
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
    await db.update(paymentTransactions).set({ status: "FAILED", reviewedBy: auth.session.userId, reviewedAt: new Date(), resultDescription: input.note?.trim() || "Payment proof rejected by administrator." }).where(eq(paymentTransactions.id, payment.id));
    await db.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, payment.orderId));
    await db.insert(activityLogs).values({ actorId:auth.session.userId, action:"PAYMENT_REJECTED", entityType:"order", entityId:String(payment.orderId), metadata:{ transactionId:payment.id, amount:payment.amount, actorRole:auth.session.role } });
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
  if (!order || !order.orderNumber.startsWith("POS-")) return json({ error: "Pending counter sale not found." }, { status: 404 });
  if (order.paymentStatus === "PAID") return json({ error: "A paid sale cannot be cancelled here." }, { status: 409 });
  await db.transaction(async (tx) => {
    const items = await tx.select({ id: orderItems.id, productId: orderItems.productId }).from(orderItems).where(eq(orderItems.orderId, order.id));
    const fulfilments = items.length ? await tx.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id))) : [];
    for (const fulfilment of fulfilments) {
      const item = items.find((entry) => entry.id === fulfilment.orderItemId);
      if (!item?.productId || fulfilment.quantityReserved <= 0) continue;
      const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, fulfilment.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
      if (stock) await tx.update(branchInventory).set({ quantityReserved: Math.max(0, stock.quantityReserved - fulfilment.quantityReserved), updatedBy: auth.session.userId }).where(eq(branchInventory.id, stock.id));
      await tx.update(orderItemFulfilments).set({ quantityReserved: 0, status: "UNAVAILABLE" }).where(eq(orderItemFulfilments.id, fulfilment.id));
    }
    await tx.update(paymentTransactions).set({ status: "CANCELLED", reviewedBy: auth.session.userId, reviewedAt: new Date(), resultDescription: "Counter sale cancelled by teller." }).where(and(eq(paymentTransactions.orderId, order.id), ne(paymentTransactions.status, "PAID")));
    await tx.update(orders).set({ status: "CANCELLED", paymentStatus: "FAILED" }).where(eq(orders.id, order.id));
    await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "WALK_IN_SALE_CANCELLED", entityType: "order", entityId: String(order.id), metadata: { orderNumber: order.orderNumber } });
  });
  return json({ ok: true });
}

export async function handleStkNotification(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseStkCallback(payload);
  if (!parsed.checkoutRequestId || !parsed.merchantRequestId) return json({ ResultCode: 1, ResultDesc: "Invalid notification" }, { status: 400 });
  const db = getDb();
  let callbackId = 0;
  try { const [created] = await db.insert(mpesaStkCallbacks).values({ checkoutRequestId: parsed.checkoutRequestId, providerPayload: payload }); callbackId = created.insertId; }
  catch { const [existing] = await db.select({ id: mpesaStkCallbacks.id }).from(mpesaStkCallbacks).where(eq(mpesaStkCallbacks.checkoutRequestId, parsed.checkoutRequestId)).limit(1); callbackId = existing?.id || 0; }
  const [payment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.checkoutRequestId, parsed.checkoutRequestId)).limit(1);
  if (!payment) return json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (!payment.merchantRequestId || payment.merchantRequestId !== parsed.merchantRequestId) {
    console.warn("Rejected mismatched STK notification", { transactionId: payment.id });
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (parsed.resultCode === "0" && parsed.receiptNumber && parsed.amount !== null) {
    try { await markPaymentPaid(payment.id, { receiptNumber: parsed.receiptNumber, amount: parsed.amount, phone: parsed.phone, providerPayload: payload }); }
    catch (error) { console.error("Mobile-money notification requires review", { transactionId: payment.id, error }); }
  } else {
    await db.update(paymentTransactions).set({ status: "FAILED", resultCode: parsed.resultCode, resultDescription: parsed.resultDescription, providerPayload: payload }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
    await db.update(orders).set({ paymentStatus: "FAILED" }).where(and(eq(orders.id, payment.orderId), eq(orders.paymentStatus, "PENDING")));
  }
  if (callbackId) await db.update(mpesaStkCallbacks).set({ processedTransactionId: payment.id }).where(eq(mpesaStkCallbacks.id, callbackId));
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
    await db.update(paymentTransactions).set({ status: "FAILED", resultCode: parsed.resultCode, resultDescription: parsed.resultDescription, providerPayload: stored.providerPayload }).where(and(eq(paymentTransactions.id, payment.id), eq(paymentTransactions.status, "PENDING")));
    await db.update(orders).set({ paymentStatus: "FAILED" }).where(and(eq(orders.id, payment.orderId), eq(orders.paymentStatus, "PENDING")));
  }
  await db.update(mpesaStkCallbacks).set({ processedTransactionId: payment.id }).where(eq(mpesaStkCallbacks.id, stored.id));
  return true;
}

export async function handleC2bConfirmation(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const incoming = parseC2bPayment(payload);
  const db = getDb();
  let incomingId = 0;
  try {
    const [created] = await db.insert(mpesaIncomingPayments).values({ ...incoming, amount: incoming.amount.toFixed(2), providerPayload: payload });
    incomingId = created.insertId;
  } catch { return json({ ResultCode: 0, ResultDesc: "Duplicate accepted" }); }
  const [receiptPayment] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.receiptNumber, incoming.receiptNumber)).limit(1);
  let payment: typeof paymentTransactions.$inferSelect | undefined = receiptPayment;
  if (!payment) {
    const candidates = await db.select({ payment: paymentTransactions, orderNumber: orders.orderNumber }).from(paymentTransactions).innerJoin(orders, eq(orders.id, paymentTransactions.orderId)).where(and(eq(paymentTransactions.channel, "POS"), eq(paymentTransactions.method, "MANUAL_MPESA"), eq(paymentTransactions.status, "PENDING"), gte(paymentTransactions.createdAt, new Date(Date.now() - 30 * 60_000)))).orderBy(desc(paymentTransactions.createdAt)).limit(40);
    const amountMatches = candidates.filter((row) => Math.abs(Number(row.payment.amount) - incoming.amount) <= 0.001);
    const referenceMatch = amountMatches.find((row) => incoming.accountReference?.toUpperCase() === row.orderNumber.toUpperCase());
    const normalized = paymentPhone(incoming.phone);
    const phoneMatches = normalized ? amountMatches.filter((row) => paymentPhone(row.payment.phone) === normalized) : [];
    payment = (referenceMatch || (phoneMatches.length === 1 ? phoneMatches[0] : null) || (!normalized && amountMatches.length === 1 ? amountMatches[0] : null))?.payment;
  }
  if (payment && Math.abs(Number(payment.amount) - incoming.amount) <= 0.001) {
    try {
      await markPaymentPaid(payment.id, { receiptNumber: incoming.receiptNumber, amount: incoming.amount, phone: incoming.phone, providerPayload: payload });
      await db.update(mpesaIncomingPayments).set({ matchedTransactionId: payment.id }).where(eq(mpesaIncomingPayments.id, incomingId));
    } catch (error) { console.error("C2B payment match requires review", { transactionId: payment.id, error }); }
  }
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}

export async function handleC2bVerification(request: Request) {
  if (request.method !== "POST") return json({ ResultCode: 1, ResultDesc: "Method not allowed" }, { status: 405 });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  try { parseC2bPayment(payload); return json({ ResultCode: 0, ResultDesc: "Accepted" }); }
  catch { return json({ ResultCode: "C2B00012", ResultDesc: "Invalid transaction details" }); }
}

export function paymentConfigurationSummary() {
  return { mpesaConfigured: Boolean(mpesaConfiguration()) };
}
