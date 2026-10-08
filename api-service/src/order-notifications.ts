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
import { notifyCustomer } from "./customer-notify";
import { notificationSettings, pharmacyIdentity } from "./notification-settings";
import { channelEnabled, orderStatusEvent, type CustomerNotificationEventId } from "../../lib/notification-events";
import { orderSms, orderStatusSms, orderStatusSmsPurpose, type OrderSmsContext, type SmsPurpose } from "../../lib/sms-templates";
import { vatRateLabel } from "../../lib/vat";
import { orderEmailHtml, orderStatusEmailContent, posReceiptEmailHtml, sendEmail, shouldAttachOfficialReceipt, storefrontOrigin, type EmailAttachment } from "./email";

export type ReceiptNotificationTrigger = "PAYMENT_CONFIRMED" | "ORDER_COMPLETED";

/** The order fields every customer message is composed from. */
async function loadOrderMessageContext(orderId: number) {
  const db = getDb();
  const [order] = await db
    .select({
      orderNumber: orders.orderNumber, phone: orders.phone, email: orders.email, customerName: orders.customerName,
      total: orders.total, paymentStatus: orders.paymentStatus, fulfilmentMethod: orders.fulfilmentMethod,
      branchName: branches.name,
    })
    .from(orders)
    .leftJoin(branches, eq(branches.id, orders.suggestedBranchId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const identity = await pharmacyIdentity();
  const total = Number(order.total);
  const sms: OrderSmsContext = {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    total,
    // Only an unpaid order has anything left for the rider to collect.
    amountDue: order.paymentStatus === "PAID" ? null : total,
    branchName: order.branchName,
    pharmacyName: identity.pharmacyName ?? undefined,
    pharmacyPhone: identity.pharmacyPhone,
  };
  return { order, sms };
}

/**
 * Tells the customer their order moved to `status`, by whichever of email and SMS the
 * admin has switched on for that step.
 *
 * Reads the order after the save, so contact details staff corrected in the same request
 * are the ones used. Completion is the one step whose email is the paid receipt, so that
 * goes through notifyPaidOrder and only the SMS is composed here.
 */
export async function notifyOrderStatusChange(orderId: number, status: string) {
  const event = orderStatusEvent(status);
  if (!event) return;
  try {
    const context = await loadOrderMessageContext(orderId);
    if (!context) return;
    const { order, sms } = context;
    const { customerName: name, email } = order;
    const update = status === "COMPLETED"
      ? null
      : orderStatusEmailContent({ name, orderId, orderNumber: order.orderNumber, status, fulfilmentMethod: order.fulfilmentMethod, storefrontOrigin: storefrontOrigin() });
    await notifyCustomer(event, {
      email: update && email ? { to: email, ...update, channel: "orders" } : null,
      sms: { to: order.phone, message: orderStatusSms(status, { ...sms, customerName: name }), purpose: orderStatusSmsPurpose(status), orderId },
    });
    if (status === "COMPLETED") await notifyPaidOrder(orderId, "ORDER_COMPLETED");
  } catch (error) {
    console.error("Order status notification failed", { orderId, status, error });
  }
}

export function queueOrderStatusNotification(orderId: number, status: string) {
  void notifyOrderStatusChange(orderId, status);
}

/**
 * The SMS half of "your order was received": the placed-order confirmation, its cash-on-
 * delivery variant, or the closing confirmation for a counter sale. Which one is the
 * caller's call, since only it knows how the order was paid.
 */
export async function notifyOrderBySms(orderId: number, purpose: Extract<SmsPurpose, "ORDER_RECEIVED" | "CASH_ON_DELIVERY_DUE" | "POS_SALE_COMPLETE">) {
  try {
    const context = await loadOrderMessageContext(orderId);
    if (!context?.order.phone) return;
    await notifyCustomer(purpose === "POS_SALE_COMPLETE" ? "POS_SALE" : "ORDER_PLACED", {
      sms: { to: context.order.phone, message: orderSms(purpose, context.sms), purpose, orderId },
    });
  } catch (error) {
    console.error("Order SMS failed", { orderId, purpose, error });
  }
}

export function queueOrderSms(orderId: number, purpose: Parameters<typeof notifyOrderBySms>[1]) {
  void notifyOrderBySms(orderId, purpose);
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
  // The emailed receipt is the same document as the printed one, so it discloses VAT
  // the same way: extracted from the total, and only when the shop has switched it on.
  const business = input.settings ?? { pharmacyName: "Healthfield Pharmacy", phone: null, address: null, licenceNumber: null };
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
    // The VAT actually charged, stored with the order, so the receipt reproduces the
    // sale rather than reapplying today's rate to an old total.
    vat: Number(input.order.vat) > 0 ? Number(input.order.vat) : null,
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
    business,
    servedBy,
    receiptNumber,
    vatLabel: vatRateLabel(Number(input.order.vatRate) || business.vatRate),
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
      taxNumber: siteSettings.taxNumber,
      vatEnabled: siteSettings.vatEnabled,
      vatRate: siteSettings.vatRate,
    }).from(siteSettings).limit(1),
    db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id)).orderBy(desc(paymentTransactions.createdAt)),
  ]);
  const settings = settingsRows[0];
  const paymentReference = order.paymentReference || order.orderNumber;
  const paidPayment = payments.find((entry) => entry.status === "PAID") ?? payments[0] ?? null;
  const posSale = paidPayment?.channel === "POS";
  const officialReceipt = shouldAttachOfficialReceipt({ paymentChannel: paidPayment?.channel, orderStatus: order.status, trigger });
  // The same function sends three different customer messages — a counter receipt, the
  // receipt on completion, and the "payment confirmed" note — and each has its own switch.
  const event: CustomerNotificationEventId = officialReceipt ? (posSale ? "POS_SALE" : "ORDER_COMPLETED") : "ORDER_PAYMENT_CONFIRMED";
  const { customer: customerPreferences } = await notificationSettings();

  if (order.email && channelEnabled(customerPreferences, event, "email")) {
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
            settings: settings ? { pharmacyName: settings.pharmacyName, phone: settings.phone, address: settings.address, licenceNumber: settings.licenceNumber, taxNumber: settings.taxNumber, vatEnabled: settings.vatEnabled, vatRate: settings.vatRate } : null,
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

  // The counter sale and the completed order send their own SMS, from the places that
  // know about them (queueOrderSms and notifyOrderStatusChange). Only the payment note is
  // sent from here, since this is the one place that knows when the money was matched.
  // Routing it per trigger is also what keeps a counter sale from receiving both a
  // payment confirmation and a sale confirmation for one transaction.
  if (event === "ORDER_PAYMENT_CONFIRMED") {
    const identity = await pharmacyIdentity();
    await notifyCustomer(event, {
      sms: {
        to: receiptPhone(order.phone),
        message: orderSms("PAYMENT_CONFIRMED", { orderNumber: order.orderNumber, customerName: order.customerName, total: Number(order.amountPaid), pharmacyName: identity.pharmacyName ?? undefined, pharmacyPhone: identity.pharmacyPhone }),
        purpose: "PAYMENT_CONFIRMED",
        orderId: order.id,
      },
    });
  }
}

export function queuePaidOrderNotification(orderId: number, trigger: ReceiptNotificationTrigger = "PAYMENT_CONFIRMED") {
  void notifyPaidOrder(orderId, trigger).catch((error) => console.error("Payment receipt notification failed", { orderId, trigger, error }));
}
