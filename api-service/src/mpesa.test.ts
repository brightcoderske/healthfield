import assert from "node:assert/strict";
import test from "node:test";
import { buildC2bCallbackUrls, buildStkNotificationUrl, buildStkPushPayload, classifyStkQueryResult, extractMpesaReceipt, mpesaPassword, mpesaTimestamp, normalizeKenyanPhone, normalizePaymentReference, parseC2bPayment, parseStkCallback, type MpesaConfiguration } from "./mpesa.ts";

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

test("builds the neutral public STK notification URL", () => {
  assert.equal(
    buildStkNotificationUrl("https://api.healthfieldpharmacy.co.ke/", "secret/value"),
    "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/stk/notification/secret%2Fvalue",
  );
});

test("builds secret-protected C2B callback URLs and normalizes order references", () => {
  assert.deepEqual(buildC2bCallbackUrls("https://api.healthfieldpharmacy.co.ke/", "secret/value"), {
    confirmationUrl: "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/c2b/confirmation/secret%2Fvalue",
    validationUrl: "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/c2b/verification/secret%2Fvalue",
  });
  assert.equal(normalizePaymentReference("POS-ME8K-12ab"), "POSME8K12AB");
  assert.equal(normalizePaymentReference(" pos me8k 12ab "), "POSME8K12AB");
});

test("builds the documented Buy Goods STK request shape", () => {
  const config: MpesaConfiguration = {
    baseUrl: "https://api.safaricom.co.ke",
    consumerKey: "key",
    consumerSecret: "secret",
    shortcode: "4502013",
    partyB: "8351072",
    passkey: "passkey",
    transactionType: "CustomerBuyGoodsOnline",
    callbackSecret: "a-secure-callback-secret-at-least-24-characters",
    callbackBaseUrl: "https://api.healthfieldpharmacy.co.ke",
  };
  const timestamp = "20260812180000";
  const payload = buildStkPushPayload(config, { orderNumber: "HF-123456789012", phone: "254712345678", amount: 370 }, timestamp);
  assert.equal(payload.BusinessShortCode, 4502013);
  assert.equal(payload.PartyB, 8351072);
  assert.equal(payload.TransactionType, "CustomerBuyGoodsOnline");
  assert.equal(payload.PartyA, 254712345678);
  assert.equal(payload.PhoneNumber, 254712345678);
  assert.equal(payload.AccountReference, "HF1234567890");
  assert.equal(payload.TransactionDesc.length <= 13, true);
  assert.equal(payload.CallBackURL, "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/stk/notification/a-secure-callback-secret-at-least-24-characters");
});

test("keeps not-yet-queryable STK requests pending", () => {
  assert.deepEqual(classifyStkQueryResult({ ResultCode: "1", ResultDesc: "The transaction does not Exist" }), {
    state: "PENDING",
    resultCode: "1",
    resultDescription: "The transaction does not Exist",
  });
  assert.equal(classifyStkQueryResult({ ResultDesc: "The transaction is being processed" }).state, "PENDING");
});

test("only finalizes known terminal STK query outcomes", () => {
  assert.equal(classifyStkQueryResult({ ResultCode: 0, ResultDesc: "Success" }).state, "PAID");
  assert.equal(classifyStkQueryResult({ ResultCode: 1032, ResultDesc: "Request cancelled by user" }).state, "FAILED");
  assert.equal(classifyStkQueryResult({ ResultCode: 7777, ResultDesc: "Unknown provider state" }).state, "PENDING");
});

test("extracts receipts and parses successful callbacks", () => {
  assert.equal(extractMpesaReceipt("Confirmed. M-PESA code TGH7K2AB91 paid"), "TGH7K2AB91");
  const parsed = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "c", ResultCode: 0, ResultDesc: "Success", CallbackMetadata: { Item: [{ Name: "Amount", Value: 1250 }, { Name: "MpesaReceiptNumber", Value: "TGH7K2AB91" }, { Name: "PhoneNumber", Value: 254712345678 }] } } } });
  assert.deepEqual(parsed, { checkoutRequestId: "c", merchantRequestId: "m", resultCode: "0", resultDescription: "Success", receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678" });
});

test("parses C2B till confirmations", () => {
  assert.deepEqual(parseC2bPayment({ TransID: "TGH7K2AB91", TransAmount: "1250.00", MSISDN: "254712345678", FirstName:"Jane", MiddleName:"W", LastName:"Njeri", BillRefNumber: "HF-123" }), { receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678", payerName:"Jane W Njeri", accountReference: "HF-123", transactionTime: null });
});
