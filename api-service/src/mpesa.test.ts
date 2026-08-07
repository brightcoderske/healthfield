import assert from "node:assert/strict";
import test from "node:test";
import { extractMpesaReceipt, mpesaPassword, mpesaTimestamp, normalizeKenyanPhone, parseC2bPayment, parseStkCallback } from "./mpesa.ts";

test("normalizes supported Kenyan mobile number formats", () => {
  assert.equal(normalizeKenyanPhone("0712 345 678"), "254712345678");
  assert.equal(normalizeKenyanPhone("+254 712 345 678"), "254712345678");
  assert.throws(() => normalizeKenyanPhone("020 123 4567"));
});

test("builds Daraja timestamp and password", () => {
  const timestamp = mpesaTimestamp(new Date(2026, 7, 7, 14, 5, 9));
  assert.equal(timestamp, "20260807140509");
  assert.equal(mpesaPassword("174379", "pass", timestamp), Buffer.from(`174379pass${timestamp}`).toString("base64"));
});

test("extracts receipts and parses successful callbacks", () => {
  assert.equal(extractMpesaReceipt("Confirmed. M-PESA code TGH7K2AB91 paid"), "TGH7K2AB91");
  const parsed = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "c", ResultCode: 0, ResultDesc: "Success", CallbackMetadata: { Item: [{ Name: "Amount", Value: 1250 }, { Name: "MpesaReceiptNumber", Value: "TGH7K2AB91" }, { Name: "PhoneNumber", Value: 254712345678 }] } } } });
  assert.deepEqual(parsed, { checkoutRequestId: "c", merchantRequestId: "m", resultCode: "0", resultDescription: "Success", receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678" });
});

test("parses C2B till confirmations", () => {
  assert.deepEqual(parseC2bPayment({ TransID: "TGH7K2AB91", TransAmount: "1250.00", MSISDN: "254712345678", BillRefNumber: "HF-123" }), { receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678", accountReference: "HF-123", transactionTime: null });
});
