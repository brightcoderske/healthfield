import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activityLogs, branchInventory, branches, orderItemFulfilments, orderItems, orders,
  paymentTransactions, posHeldSales, posSessions, posTills, products, siteSettings,
} from "../../db/schema";
import { cashChange, saleTotal, splitPaymentBalances } from "../../lib/pos";
import { parseVatRate, vatOnNet } from "../../lib/vat";
import { healthfieldOrderNumber } from "../../lib/order-number";
import { getDb } from "./db";
import { json } from "./http";
import { initiateStkPush, mpesaConfiguration } from "./mpesa";
import { queueOrderSms, queuePaidOrderNotification } from "./order-notifications";
import { reconcileManualPaymentFromIncoming, replayStoredStkCallback } from "./payment-handlers";
import { consumePosBatches } from "./pos-inventory";
import { requireTeamPermission } from "./staff-permissions";

const partSchema = z.object({
  method: z.enum(["CASH", "MPESA_EXPRESS", "MANUAL_MPESA"]),
  amount: z.coerce.number().finite().positive().max(100_000_000),
  cashReceived: z.coerce.number().finite().nonnegative().max(100_000_000).optional(),
  phone: z.string().trim().max(30).optional(),
});

function allocateDiscount<T extends { base: number }>(lines: T[], discount: number) {
  const subtotal = lines.reduce((sum, line) => sum + line.base, 0);
  let allocated = 0;
  return lines.map((line, index) => {
    const lineDiscount = index === lines.length - 1 ? discount - allocated : Math.round((discount * line.base / subtotal) * 100) / 100;
    allocated += lineDiscount;
    return { ...line, total: Math.round((line.base - lineDiscount) * 100) / 100 };
  });
}

/** Session-aware replacement for the original counter-sale handler. */
export async function handlePosSale(request: Request) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z.object({
    sessionId: z.coerce.number().int().positive(), heldSaleId: z.coerce.number().int().positive().optional(),
    customerName: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().optional().or(z.literal("")),
    checkoutToken: z.string().uuid(), discountAmount: z.coerce.number().finite().nonnegative().max(100_000_000).default(0),
    items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(999) })).min(1).max(250),
    payments: z.array(partSchema).min(1).max(2), chargeVat: z.coerce.boolean().default(false),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the session, cart, discount and payment amounts." }, { status: 400 });
  const methods = parsed.data.payments.map((part) => part.method);
  if (new Set(methods).size !== methods.length) return json({ error: "Use each payment method only once in a split sale." }, { status: 400 });
  if (parsed.data.payments.length > 1 && !methods.includes("CASH")) return json({ error: "A split sale must combine cash with one M-PESA method." }, { status: 400 });
  const db = getDb();
  const [duplicate] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, total: orders.total, paymentStatus: orders.paymentStatus, paymentReference: orders.paymentReference }).from(orders).where(eq(orders.checkoutToken, parsed.data.checkoutToken)).limit(1);
  if (duplicate) return json({ ok: true, id: duplicate.id, orderNumber: duplicate.orderNumber, total: Number(duplicate.total), paymentStatus: duplicate.paymentStatus, receiptNumber: duplicate.paymentReference, duplicate: true });

  const grouped = new Map<number, number>();
  for (const item of parsed.data.items) grouped.set(item.productId, (grouped.get(item.productId) || 0) + item.quantity);
  const requested = [...grouped].map(([productId, quantity]) => ({ productId, quantity }));
  const catalog = await db.select().from(products).where(and(inArray(products.id, requested.map((item) => item.productId)), eq(products.isActive, true)));
  if (catalog.length !== requested.length) return json({ error: "One or more products are unavailable." }, { status: 409 });
  const rawLines = requested.map((item) => {
    const product = catalog.find((entry) => entry.id === item.productId)!;
    const price = Number(product.discountPrice ?? product.price);
    return { product, quantity: item.quantity, base: Math.round(price * item.quantity * 100) / 100 };
  });
  const subtotal = rawLines.reduce((sum, line) => sum + line.base, 0);
  if (parsed.data.discountAmount > subtotal) return json({ error: "The discount cannot be higher than the sale subtotal." }, { status: 400 });
  const net = saleTotal(subtotal, parsed.data.discountAmount);
  if (net <= 0) return json({ error: "A completed sale must have a positive total." }, { status: 400 });
  const [settings] = await db.select({ posCashEnabled: siteSettings.posCashEnabled, posMpesaEnabled: siteSettings.posMpesaEnabled, posManualEnabled: siteSettings.posManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber, vatRate: siteSettings.vatRate }).from(siteSettings).limit(1);
  // Shelf prices are net of VAT, so tax is added on top of the goods; delivery is not
  // charged on a walk-in sale, so the whole net amount is the VAT base.
  const vatRate = parsed.data.chargeVat ? parseVatRate(settings?.vatRate) : 0;
  const vat = vatRate ? vatOnNet(net, vatRate) ?? 0 : 0;
  if (parsed.data.chargeVat && !vat) return json({ error: "Set a VAT rate in settings before charging VAT on a sale." }, { status: 409 });
  const total = Math.round((net + vat) * 100) / 100;
  if (!splitPaymentBalances(total, parsed.data.payments)) return json({ error: `Payment parts must add up to KES ${total.toLocaleString("en-KE")}.` }, { status: 400 });
  const cashPart = parsed.data.payments.find((part) => part.method === "CASH");
  const change = cashPart ? cashChange(cashPart.amount, cashPart.cashReceived ?? cashPart.amount) : 0;
  if (cashPart && change === null) return json({ error: "Cash received is less than the cash amount due." }, { status: 400 });
  for (const part of parsed.data.payments.filter((entry) => entry.method === "MPESA_EXPRESS")) {
    if (!Number.isInteger(part.amount)) return json({ error: "M-PESA Express requires a whole-shilling amount." }, { status: 409 });
    if (!(part.phone || parsed.data.phone)) return json({ error: "Enter the phone number that will receive the M-PESA prompt." }, { status: 400 });
  }
  const [saleSession] = await db.select({
    status: posSessions.status,
    userId: posSessions.userId,
    tillNumber: posTills.mpesaTillNumber,
  }).from(posSessions).innerJoin(posTills, eq(posTills.id, posSessions.tillId))
    .where(eq(posSessions.id, parsed.data.sessionId)).limit(1);
  if (!saleSession || saleSession.userId !== auth.session.userId || saleSession.status !== "OPEN") {
    return json({ error: "Open your POS session before making a sale." }, { status: 409 });
  }
  if (cashPart && settings?.posCashEnabled === false) return json({ error: "Cash payment is disabled in settings." }, { status: 409 });
  if (methods.includes("MPESA_EXPRESS") && (!settings?.posMpesaEnabled || !mpesaConfiguration())) return json({ error: "M-PESA Express is unavailable." }, { status: 409 });
  if (methods.includes("MANUAL_MPESA") && (!settings?.posManualEnabled || !(saleSession.tillNumber || settings.mpesaTillNumber))) return json({ error: "Till payment is unavailable." }, { status: 409 });

  try {
    const created = await db.transaction(async (tx) => {
      const [session] = await tx.select().from(posSessions).where(and(eq(posSessions.id, parsed.data.sessionId), eq(posSessions.userId, auth.session.userId))).limit(1).for("update");
      if (!session || session.status !== "OPEN") throw new Error("Open your POS session before making a sale.");
      const [branch] = await tx.select({ id: branches.id, code: branches.code }).from(branches).where(and(eq(branches.id, session.branchId), eq(branches.isActive, true))).limit(1);
      if (!branch) throw new Error("The session branch is no longer active.");
      const stockRows = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, branch.id), inArray(branchInventory.productId, requested.map((item) => item.productId)))).for("update");
      for (const item of requested) {
        const stock = stockRows.find((row) => row.productId === item.productId);
        if (!stock || stock.quantityAvailable - stock.quantityReserved < item.quantity) throw new Error(`Insufficient stock for ${catalog.find((row) => row.id === item.productId)!.name}.`);
      }
      const cashOnly = parsed.data.payments.length === 1 && cashPart;
      const temporaryOrderNumber = `TMP-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
      const [order] = await tx.insert(orders).values({
        orderNumber: temporaryOrderNumber, checkoutToken: parsed.data.checkoutToken,
        customerName: parsed.data.customerName || "Walk-in customer", phone: parsed.data.phone || "Walk-in", email: parsed.data.email || null,
        fulfilmentMethod: "PICKUP", status: cashOnly ? "COMPLETED" : "AWAITING_PAYMENT", paymentStatus: cashOnly ? "PAID" : "PENDING",
        paymentMethod: parsed.data.payments.length > 1 ? "SPLIT" : parsed.data.payments[0].method,
        amountPaid: cashPart ? cashPart.amount.toFixed(2) : "0", subtotal: subtotal.toFixed(2), deliveryFee: "0", discount: parsed.data.discountAmount.toFixed(2), vat: vat.toFixed(2), vatRate: vatRate.toFixed(2), total: total.toFixed(2),
        suggestedBranchId: branch.id, posSessionId: session.id, cashierId: auth.session.userId, tillId: session.tillId, transactedAt: sql`current_timestamp`,
      });
      const orderNumber = healthfieldOrderNumber(branch.code, order.insertId);
      const cashReference = cashPart ? `CASH-${orderNumber}${parsed.data.payments.length > 1 ? "-PART" : ""}` : null;
      await tx.update(orders).set({ orderNumber, paymentReference: cashOnly ? cashReference : null }).where(eq(orders.id, order.insertId));
      const lines = allocateDiscount(rawLines, parsed.data.discountAmount);
      for (const line of lines) {
        const effectiveUnit = line.total / line.quantity;
        const [item] = await tx.insert(orderItems).values({ orderId: order.insertId, productId: line.product.id, productName: line.product.name, quantity: line.quantity, unitPrice: effectiveUnit.toFixed(2), lineTotal: line.total.toFixed(2), unitCost: line.product.costPrice ?? null });
        const stock = stockRows.find((row) => row.productId === line.product.id)!;
        await tx.update(branchInventory).set({ quantityAvailable: cashOnly ? stock.quantityAvailable - line.quantity : stock.quantityAvailable, quantityReserved: cashOnly ? stock.quantityReserved : stock.quantityReserved + line.quantity, updatedBy: auth.session.userId }).where(eq(branchInventory.id, stock.id));
        if (cashOnly) await consumePosBatches(tx, branch.id, line.product.id, line.quantity);
        await tx.insert(orderItemFulfilments).values({ orderItemId: item.insertId, branchId: branch.id, handledBy: auth.session.userId, quantityReserved: cashOnly ? 0 : line.quantity, quantityPacked: cashOnly ? line.quantity : 0, status: cashOnly ? "READY" : "RESERVED" });
      }
      const paymentIds: Array<{ id: number; method: typeof parsed.data.payments[number]["method"]; amount: number }> = [];
      for (const part of parsed.data.payments) {
        const paid = part.method === "CASH";
        const [payment] = await tx.insert(paymentTransactions).values({
          orderId: order.insertId, method: part.method, channel: "POS", status: paid ? "PAID" : part.method === "MANUAL_MPESA" ? "PENDING" : "INITIATED",
          amount: part.amount.toFixed(2), tenderedAmount: part.method === "CASH" ? (part.cashReceived ?? part.amount).toFixed(2) : null,
          changeGiven: part.method === "CASH" ? (change || 0).toFixed(2) : null, phone: part.phone || parsed.data.phone || null,
          receiptNumber: paid ? cashReference : null, verifiedAt: paid ? sql`current_timestamp` : null, reviewedBy: paid ? auth.session.userId : null, reviewedAt: paid ? sql`current_timestamp` : null,
        });
        paymentIds.push({ id: payment.insertId, method: part.method, amount: part.amount });
      }
      if (parsed.data.heldSaleId) {
        const [held] = await tx.select({ id: posHeldSales.id }).from(posHeldSales).where(and(eq(posHeldSales.id, parsed.data.heldSaleId), eq(posHeldSales.sessionId, session.id), inArray(posHeldSales.status, ["HELD", "RESUMED"]))).limit(1).for("update");
        if (!held) throw new Error("The held sale is no longer available.");
        await tx.update(posHeldSales).set({ status: "COMPLETED", completedOrderId: order.insertId }).where(eq(posHeldSales.id, held.id));
      }
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: cashOnly ? "POS_SALE_COMPLETED" : "POS_SALE_PAYMENT_STARTED", entityType: "order", entityId: String(order.insertId), metadata: { sessionId: session.id, branchId: branch.id, tillId: session.tillId, total, subtotal, discount: parsed.data.discountAmount, paymentMethods: methods, itemCount: lines.length } });
      return { orderId: order.insertId, orderNumber, cashOnly: Boolean(cashOnly), paymentIds, cashReference };
    });

    if (created.cashOnly) {
      queuePaidOrderNotification(created.orderId);
      queueOrderSms(created.orderId, "POS_SALE_COMPLETE");
      return json({ ok: true, paid: true, paymentStatus: "PAID", id: created.orderId, orderNumber: created.orderNumber, total, change: change || 0, receiptNumber: created.cashReference }, { status: 201 });
    }
    const messages: string[] = [];
    for (const payment of created.paymentIds) {
      if (payment.method === "MANUAL_MPESA") {
        const matched = await reconcileManualPaymentFromIncoming(payment.id);
        messages.push(matched.paid ? "Till payment matched." : "Waiting for the Till callback.");
      }
      if (payment.method === "MPESA_EXPRESS") {
        const part = parsed.data.payments.find((entry) => entry.method === "MPESA_EXPRESS")!;
        try {
          const stk = await initiateStkPush({ orderNumber: created.orderNumber, phone: part.phone || parsed.data.phone || "", amount: payment.amount });
          await db.update(paymentTransactions).set({ status: "PENDING", checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId, phone: stk.phone, resultDescription: stk.customerMessage, providerPayload: stk.providerPayload }).where(eq(paymentTransactions.id, payment.id));
          await replayStoredStkCallback(stk.checkoutRequestId);
          messages.push(stk.customerMessage);
        } catch (error) {
          const message = error instanceof Error ? error.message : "M-PESA Express could not start.";
          await db.update(paymentTransactions).set({ status: "FAILED", resultDescription: message }).where(eq(paymentTransactions.id, payment.id));
          messages.push(message);
        }
      }
    }
    const [latest] = await db.select({ paymentStatus: orders.paymentStatus, paymentReference: orders.paymentReference }).from(orders).where(eq(orders.id, created.orderId)).limit(1);
    return json({ ok: true, paid: latest.paymentStatus === "PAID", paymentStatus: latest.paymentStatus, id: created.orderId, checkoutToken: parsed.data.checkoutToken, orderNumber: created.orderNumber, total, change: change || 0, receiptNumber: latest.paymentReference, message: messages.join(" ") || "Waiting for payment confirmation." }, { status: latest.paymentStatus === "PAID" ? 201 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POS sale could not be completed.";
    console.error("POS sale failed", error);
    return json({ error: message }, { status: message.startsWith("Insufficient stock") ? 409 : 500 });
  }
}
