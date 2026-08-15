import assert from "node:assert/strict";
import test from "node:test";
import { healthfieldReceiptNumber, prepareThermalReceipt, receiptDownloadFilename, type ReceiptApiData } from "../app/admin/receipts/orders/[id]/thermal-receipt-data.ts";

const base: ReceiptApiData = {
  order: {
    id: 1,
    orderNumber: "HF-2026-001",
    customerName: "Jane Njeri",
    phone: "0700000000",
    email: null,
    fulfilmentMethod: "PICKUP",
    paymentStatus: "PAID",
    paymentMethod: "MPESA",
    paymentReference: "TGH7K2AB91",
    amountPaid: "720.00",
    subtotal: "670.00",
    deliveryFee: "100.00",
    discount: "50.00",
    total: "720.00",
    suggestedBranchId: 4,
    createdAt: "2026-08-15T09:30:00.000Z",
  },
  items: [{ productName: "Panadol Extra 12 Tablets", quantity: 1, unitPrice: "120.00", lineTotal: "120.00" }],
  stores: [{ id: 4, name: "Juja", code: "JJC", phone: "0700000000", address: "Juja Town" }],
  payments: [{ method: "MANUAL_MPESA", channel: "POS", status: "PAID", amount: "720.00", receiptNumber: "TGH7K2AB91", createdAt: "2026-08-15T09:31:00.000Z" }],
  receipt: { settings: { pharmacyName: "Healthfield Pharmacy", phone: "0700000000", address: "Juja Town", licenceNumber: "PPB-123" }, servedBy: "Alice Kamau" },
};

test("receipt number uses a seven-digit order sequence and the final branch-code character", () => {
  assert.equal(healthfieldReceiptNumber(1, "JJC"), "0000001C");
  assert.equal(healthfieldReceiptNumber(25, null), "0000025");
});

test("thermal receipt selects existing payment, branch and totals without recomputing them", () => {
  const receipt = prepareThermalReceipt(base);
  assert.equal(receipt.receiptNumber, "0000001C");
  assert.equal(receipt.branch?.name, "Juja");
  assert.equal(receipt.payment?.receiptNumber, "TGH7K2AB91");
  assert.equal(receipt.order.amountPaid, "720.00");
  assert.equal(receipt.order.total, "720.00");
  assert.equal(receipt.servedBy, "Alice Kamau");
});

test("download filename includes buyer, branch code and order sequence without a receipt suffix", () => {
  assert.equal(receiptDownloadFilename(base.order, "JJC"), "Jane-Njeri-HF-JJC-0001.pdf");
  assert.equal(receiptDownloadFilename({ ...base.order, customerName: "" }, "JJC"), "HF-JJC-0001.pdf");
});

test("VAT remains absent until supplied by backend data", () => {
  assert.equal(prepareThermalReceipt(base).order.vat, undefined);
  assert.equal(prepareThermalReceipt({ ...base, order: { ...base.order, vat: "104.50" } }).order.vat, "104.50");
});
