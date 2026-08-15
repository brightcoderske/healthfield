import assert from "node:assert/strict";
import test from "node:test";
import { orderStatusEmailContent, posReceiptEmailHtml, shouldAttachOfficialReceipt } from "./email.ts";

const receipt = {
  name: "Jane Njeri",
  orderNumber: "HF-JJC-1234",
  receiptNumber: "0001234C",
  items: [{ productName: "Panadol Extra", quantity: 1, lineTotal: "120.00" }],
  subtotal: 120,
  total: 120,
};

test("POS receipt email thanks the buyer and describes the PDF attachment", () => {
  const html = posReceiptEmailHtml({ ...receipt, attachmentIncluded: true });
  assert.match(html, /Thank you for shopping with Healthfield Pharmacy/);
  assert.match(html, /PDF receipt is attached/);
  assert.doesNotMatch(html, /We have received your order/);
  assert.doesNotMatch(html, /Check order status/);
});

test("POS receipt email does not claim an attachment when PDF generation failed", () => {
  const html = posReceiptEmailHtml({ ...receipt, attachmentIncluded: false });
  assert.match(html, /receipt details are included below/);
  assert.doesNotMatch(html, /PDF receipt is attached/);
});

test("delivery dispatch email links directly to customer receipt confirmation", () => {
  const email = orderStatusEmailContent({ name: "Jane Njeri", orderId: 1234, orderNumber: "HF-WEB-1234", status: "OUT_FOR_DELIVERY", fulfilmentMethod: "DELIVERY", storefrontOrigin: "https://healthfieldpharmacy.co.ke" });
  assert.match(email.subject, /has been dispatched/);
  assert.match(email.message, /Mark as received/);
  assert.equal(email.action.label, "Mark order as received");
  assert.equal(email.action.url, "https://healthfieldpharmacy.co.ke/account/orders/1234");
});

test("official PDF receipt is attached for POS sales and completed orders", () => {
  assert.equal(shouldAttachOfficialReceipt({ paymentChannel: "POS", orderStatus: "COMPLETED", trigger: "PAYMENT_CONFIRMED" }), true);
  assert.equal(shouldAttachOfficialReceipt({ paymentChannel: "ONLINE", orderStatus: "OUT_FOR_DELIVERY", trigger: "ORDER_COMPLETED" }), true);
  assert.equal(shouldAttachOfficialReceipt({ paymentChannel: "ONLINE", orderStatus: "COMPLETED", trigger: "PAYMENT_CONFIRMED" }), true);
});

test("online payment confirmation waits until completion for the official PDF", () => {
  assert.equal(shouldAttachOfficialReceipt({ paymentChannel: "ONLINE", orderStatus: "CONFIRMED", trigger: "PAYMENT_CONFIRMED" }), false);
});
