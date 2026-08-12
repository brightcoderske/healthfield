import { eq } from "drizzle-orm";
import { activityLogs, orderItems, orders, siteSettings } from "../../db/schema";
import { getDb } from "./db";
import { orderEmailHtml, sendEmail } from "./email";

function receiptPhone(value: string | null) {
  const phone = (value || "").trim();
  return phone && phone.toLowerCase() !== "walk-in" ? phone : null;
}

async function sendReceiptSms(input: { apiUrl: string; apiKey: string; senderId: string; phone: string; message: string }) {
  const response = await fetch(input.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ recipients: [input.phone], senderId: input.senderId, message: input.message }),
  });
  if (!response.ok) throw new Error(`Bulk SMS provider returned HTTP ${response.status}.`);
}

/**
 * Payment confirmation is authoritative even if a notification provider is down.
 * This helper therefore records delivery failures in server logs without rolling
 * back a paid order or making Safaricom retry an otherwise valid callback.
 */
export async function notifyPaidOrder(orderId: number) {
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.paymentStatus !== "PAID") return;
  const [items, settingsRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db.select({
      bulkSmsApiUrl: siteSettings.bulkSmsApiUrl,
      bulkSmsApiKey: siteSettings.bulkSmsApiKey,
      bulkSmsSenderId: siteSettings.bulkSmsSenderId,
    }).from(siteSettings).limit(1),
  ]);
  const settings = settingsRows[0];
  const receipt = order.paymentReference || order.orderNumber;

  if (order.email) {
    const delivery = await sendEmail({
      to: order.email,
      subject: `Payment receipt ${receipt}`,
      message: `Payment for order ${order.orderNumber} is confirmed. Receipt: ${receipt}. Total paid: KES ${Number(order.amountPaid).toLocaleString()}.`,
      html: orderEmailHtml({
        name: order.customerName,
        orderNumber: order.orderNumber,
        items,
        subtotal: Number(order.subtotal),
        deliveryFee: Number(order.deliveryFee),
        total: Number(order.total),
        status: `PAID · RECEIPT ${receipt}`,
      }),
      channel: "orders",
    });
    if (delivery.sent) {
      await db.insert(activityLogs).values({ actorId: null, action: "PAYMENT_RECEIPT_EMAIL_SENT", entityType: "order", entityId: String(order.id), metadata: { recipient: order.email } });
    }
  }

  const phone = receiptPhone(order.phone);
  if (phone && settings?.bulkSmsApiUrl && settings.bulkSmsApiKey && settings.bulkSmsSenderId) {
    try {
      await sendReceiptSms({
        apiUrl: settings.bulkSmsApiUrl,
        apiKey: settings.bulkSmsApiKey,
        senderId: settings.bulkSmsSenderId,
        phone,
        message: `Healthfield payment confirmed. Order ${order.orderNumber}, receipt ${receipt}, KES ${Number(order.amountPaid).toLocaleString()}. Thank you.`,
      });
      await db.insert(activityLogs).values({ actorId: null, action: "PAYMENT_RECEIPT_SMS_SENT", entityType: "order", entityId: String(order.id), metadata: { recipient: phone } });
    } catch (error) {
      console.error("Payment receipt SMS failed", { orderId: order.id, error });
    }
  }
}

export function queuePaidOrderNotification(orderId: number) {
  void notifyPaidOrder(orderId).catch((error) => console.error("Payment receipt notification failed", { orderId, error }));
}
