import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import bwipjs from "bwip-js";
import { desc, eq, inArray } from "drizzle-orm";
import { createElement } from "react";
import { ReceiptPdf } from "../../app/admin/receipts/orders/[id]/receipt-pdf";
import { healthfieldReceiptNumber, receiptDownloadFilename, type ReceiptBranch, type ReceiptBusiness, type ReceiptItem, type ReceiptOrder, type ReceiptPayment } from "../../app/admin/receipts/orders/[id]/thermal-receipt-data";
import { activityLogs, branches, orderItemFulfilments, orderItems, orders, paymentTransactions, products, siteSettings, users } from "../../db/schema";
import { getDb } from "./db";
import { sendSms, smsConfiguration } from "./sms";
import { orderSms, type SmsPurpose } from "../../lib/sms-templates";
import { orderEmailHtml, posReceiptEmailHtml, sendEmail, shouldAttachOfficialReceipt, type EmailAttachment } from "./email";

export type ReceiptNotificationTrigger = "PAYMENT_CONFIRMED" | "ORDER_COMPLETED";

/**
 * Sends one order-related SMS.
 *
 * Loads only what the wording needs, and never throws: an SMS gateway being out of
 * credit must not fail an order update. Silent when SMS is unconfigured, so the whole
 * feature stays dormant until the Celcom account exists.
 */
export async function notifyOrderBySms(orderId: number, purpose: SmsPurpose) {
  if (!smsConfiguration()) return;
  try {
    const db = getDb();
    const [order] = await db
      .select({
        orderNumber: orders.orderNumber, phone: orders.phone, customerName: orders.customerName,
        total: orders.total, paymentStatus: orders.paymentStatus, branchName: branches.name,
      })
      .from(orders)
      .leftJoin(branches, eq(branches.id, orders.suggestedBranchId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order?.phone) return;
    const [settings] = await db.select({ pharmacyName: siteSettings.pharmacyName }).from(siteSettings).limit(1);
    const total = Number(order.total);
    const message = orderSms(purpose, {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      total,
      // Only an unpaid order has anything left for the rider to collect.
      amountDue: order.paymentStatus === "PAID" ? null : total,
      branchName: order.branchName,
      pharmacyName: settings?.pharmacyName ?? undefined,
    });
    const outcome = await sendSms({ to: order.phone, message, purpose });
    if (outcome.failed) console.warn("Order SMS was not delivered", { orderId, purpose, detail: outcome.results[0]?.detail });
  } catch (error) {
    console.error("Order SMS failed", { orderId, purpose, error });
  }
}

export function queueOrderSms(orderId: number, purpose: SmsPurpose) {
  void notifyOrderBySms(orderId, purpose).catch((error) => console.error("Queued order SMS failed", { orderId, purpose, error }));
}

function receiptPhone(value: string | null) {
  const phone = (value || "").trim();
  return phone && phone.toLowerCase() !== "walk-in" ? phone : null;
}


function receiptDate(value: Date | string | null | undefined) {
  return value instanceof Date ? value.toISOString() : value || null;
}

async function optionalReceiptLogo() {
  const candidates: Array<string | URL> = [
    new URL("./receipt-logo.png", import.meta.url),
    path.join(process.cwd(), "public", "healthfield-logo-clean.png"),
  ];
  for (const candidate of candidates) {
    try {
      const logo = await readFile(candidate);
      return `data:image/png;base64,${logo.toString("base64")}`;
    } catch {
      // Try the next supported development/deployment location.
    }
  }
  return null;
}

async function paidReceiptAttachment(input: {
  order: typeof orders.$inferSelect;
  items: Array<ReceiptItem & { id: number }>;
  payments: Array<typeof paymentTransactions.$inferSelect>;
  fulfilments: Array<typeof orderItemFulfilments.$inferSelect>;
  settings: ReceiptBusiness | null;
}): Promise<{ attachment: EmailAttachment; receiptNumber: string }> {
  const db = getDb();
  const paymentRow = input.payments.find((entry) => entry.status === "PAID") ?? input.payments[0] ?? null;
  const branchId = input.fulfilments.find((entry) => entry.branchId)?.branchId ?? input.order.suggestedBranchId;
  const servedById = paymentRow?.reviewedBy ?? input.fulfilments.find((entry) => entry.handledBy)?.handledBy ?? null;
  const [branchRows, servedByRows] = await Promise.all([
    branchId
      ? db.select({ id: branches.id, name: branches.name, code: branches.code, phone: branches.phone, address: branches.address }).from(branches).where(eq(branches.id, branchId)).limit(1)
      : Promise.resolve([] as ReceiptBranch[]),
    servedById
      ? db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, servedById)).limit(1)
      : Promise.resolve([]),
  ]);
  const branch = branchRows[0] ?? null;
  const servedBy = servedByRows[0] ? `${servedByRows[0].firstName} ${servedByRows[0].lastName}`.trim() : paymentRow?.channel === "ONLINE" ? "Online order" : "POS terminal";
  const receiptNumber = healthfieldReceiptNumber(input.order.id, branch?.code);
  const barcode = await bwipjs.toBuffer({ bcid: "code128", text: receiptNumber, scale: 2, height: 7, includetext: false, paddingwidth: 0, paddingheight: 0, backgroundcolor: "FFFFFF" });
  const receiptOrder: ReceiptOrder = {
    id: input.order.id,
    orderNumber: input.order.orderNumber,
    customerName: input.order.customerName,
    phone: input.order.phone,
    email: input.order.email,
    fulfilmentMethod: input.order.fulfilmentMethod,
    paymentStatus: input.order.paymentStatus,
    paymentMethod: input.order.paymentMethod,
    paymentReference: input.order.paymentReference,
    amountPaid: input.order.amountPaid,
    subtotal: input.order.subtotal,
    deliveryFee: input.order.deliveryFee,
    discount: input.order.discount,
    total: input.order.total,
    suggestedBranchId: input.order.suggestedBranchId,
    createdAt: receiptDate(input.order.createdAt)!,
  };
  const payment: ReceiptPayment | null = paymentRow ? {
    method: paymentRow.method,
    channel: paymentRow.channel,
    status: paymentRow.status,
    amount: paymentRow.amount,
    receiptNumber: paymentRow.receiptNumber,
    createdAt: receiptDate(paymentRow.createdAt)!,
    verifiedAt: receiptDate(paymentRow.verifiedAt),
  } : null;
  const logoDataUrl = await optionalReceiptLogo();
  const pdf = await renderToBuffer(createElement(ReceiptPdf, {
    order: receiptOrder,
    items: input.items,
    payment,
    branch,
    business: input.settings ?? { pharmacyName: "Healthfield Pharmacy", phone: null, address: null, licenceNumber: null },
    servedBy,
    receiptNumber,
    barcodeDataUrl: `data:image/png;base64,${barcode.toString("base64")}`,
    logoDataUrl,
  }) as Parameters<typeof renderToBuffer>[0]);
  return {
    receiptNumber,
    attachment: {
      filename: receiptDownloadFilename(receiptOrder, branch?.code),
      content: Buffer.from(pdf),
      contentType: "application/pdf",
    },
  };
}

/**
 * Payment confirmation is authoritative even if a notification provider is down.
 * This helper therefore records delivery failures in server logs without rolling
 * back a paid order or making Safaricom retry an otherwise valid callback.
 */
export async function notifyPaidOrder(orderId: number, trigger: ReceiptNotificationTrigger = "PAYMENT_CONFIRMED") {
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.paymentStatus !== "PAID") return;
  const [items, settingsRows, payments] = await Promise.all([
    db.select({ id: orderItems.id, productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal, packSize: products.packSize }).from(orderItems).leftJoin(products, eq(products.id, orderItems.productId)).where(eq(orderItems.orderId, order.id)),
    db.select({
      pharmacyName: siteSettings.pharmacyName,
      phone: siteSettings.phone,
      address: siteSettings.address,
      licenceNumber: siteSettings.licenceNumber,
    }).from(siteSettings).limit(1),
    db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)),
  ]);
  const settings = settingsRows[0];
  const paymentReference = order.paymentReference || order.orderNumber;
  const paidPayment = payments.find((entry) => entry.status === "PAID") ?? payments[0] ?? null;
  const posSale = paidPayment?.channel === "POS";
  const officialReceipt = shouldAttachOfficialReceipt({ paymentChannel: paidPayment?.channel, orderStatus: order.status, trigger });

  if (order.email) {
    let attachment: EmailAttachment | null = null;
    let officialReceiptNumber: string | null = null;
    let pdfError: unknown = null;
    if (officialReceipt) {
      const fulfilments = items.length
        ? await db.select().from(orderItemFulfilments).where(inArray(orderItemFulfilments.orderItemId, items.map((item) => item.id)))
        : [];
      for (let attempt = 1; attempt <= 2 && !attachment; attempt += 1) {
        try {
          const generatedReceipt = await paidReceiptAttachment({
            order,
            items,
            payments,
            fulfilments,
            settings: settings ? { pharmacyName: settings.pharmacyName, phone: settings.phone, address: settings.address, licenceNumber: settings.licenceNumber } : null,
          });
          attachment = generatedReceipt.attachment;
          officialReceiptNumber = generatedReceipt.receiptNumber;
        } catch (error) {
          pdfError = error;
          console.error("Payment receipt PDF generation failed", { orderId: order.id, trigger, attempt, error });
        }
      }
      if (!attachment) {
        await db.insert(activityLogs).values({ actorId: null, action: "PAYMENT_RECEIPT_PDF_FAILED", entityType: "order", entityId: String(order.id), metadata: { recipient: order.email, trigger, error: pdfError instanceof Error ? pdfError.message : "Unknown PDF generation error" } });
      }
    }
    if (!officialReceipt || attachment) {
      const delivery = await sendEmail({
      to: order.email,
      subject: officialReceipt ? (posSale ? `Your Healthfield receipt ${officialReceiptNumber}` : `Receipt for completed order ${order.orderNumber}`) : `Payment confirmed for ${order.orderNumber}`,
      message: officialReceipt ? `Thank you for shopping with Healthfield Pharmacy. Your official receipt ${officialReceiptNumber} for KES ${Number(order.amountPaid).toLocaleString()} is attached as a PDF.` : `Payment for order ${order.orderNumber} is confirmed. Total paid: KES ${Number(order.amountPaid).toLocaleString()}. We will keep you updated as the order is processed.`,
      html: officialReceipt ? posReceiptEmailHtml({
        name: order.customerName,
        orderNumber: order.orderNumber,
        receiptNumber: officialReceiptNumber!,
        items,
        subtotal: Number(order.subtotal),
        total: Number(order.amountPaid),
        attachmentIncluded: true,
      }) : orderEmailHtml({
        name: order.customerName,
        orderNumber: order.orderNumber,
        items,
        subtotal: Number(order.subtotal),
        deliveryFee: Number(order.deliveryFee),
        total: Number(order.total),
        status: "PAID",
      }),
      channel: "orders",
      attachments: attachment ? [attachment] : undefined,
      });
      if (delivery.sent) {
        await db.insert(activityLogs).values({ actorId: null, action: officialReceipt ? "PAYMENT_RECEIPT_EMAIL_SENT" : "PAYMENT_CONFIRMATION_EMAIL_SENT", entityType: "order", entityId: String(order.id), metadata: { recipient: order.email, trigger, officialReceiptNumber, paymentReference, pdfAttached: Boolean(attachment), attachmentBytes: attachment?.content.length ?? null } });
      }
    }
  }

  // SMS is no longer sent from here. It used to post to a generic gateway shape that
  // Celcom does not accept — bearer auth and a `recipients` array — so it had never in
  // fact delivered anything. Each moment that warrants a message now sends its own
  // through ./sms: the counter sale, the placed order, and the ready-for-collection or
  // out-for-delivery update. Routing it per trigger is also what keeps a POS sale from
  // receiving both a payment confirmation and a sale confirmation for one transaction.
}

export function queuePaidOrderNotification(orderId: number, trigger: ReceiptNotificationTrigger = "PAYMENT_CONFIRMED") {
  void notifyPaidOrder(orderId, trigger).catch((error) => console.error("Payment receipt notification failed", { orderId, trigger, error }));
}
