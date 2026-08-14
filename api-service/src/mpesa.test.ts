import assert from "node:assert/strict";
import test from "node:test";
import { buildC2bCallbackUrls, buildPaymentRecoveryCallbackUrls, buildPullTransactionsQueryPayload, buildStkNotificationUrl, buildStkPushPayload, buildTransactionStatusPayload, classifyStkQueryResult, extractMpesaReceipt, mpesaPassword, mpesaTimestamp, normalizeKenyanPhone, normalizePaymentReference, parseC2bPayment, parsePullTransactions, parseStkCallback, parseTransactionStatusResult, paymentReferenceMatchesOrder, selectIncomingPaymentCandidate, stkBackgroundReconcileDelay, stkReconciliationReference, type MpesaConfiguration } from "./mpesa.ts";

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
  assert.equal(paymentReferenceMatchesOrder("HF1234567890", "HF-123456789012"), true);
});

test("builds separate secret-protected Transaction Status and Pull callback URLs", () => {
  assert.deepEqual(buildPaymentRecoveryCallbackUrls("https://api.healthfieldpharmacy.co.ke/", "secret/value"), {
    transactionStatusResultUrl: "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/status/result/secret%2Fvalue",
    transactionStatusTimeoutUrl: "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/status/timeout/secret%2Fvalue",
    pullNotificationUrl: "https://api.healthfieldpharmacy.co.ke/v1/payments/mobile-money/recovery/notification/secret%2Fvalue",
  });
});

test("builds documented Transaction Status and Pull query payloads", () => {
  const urls = buildPaymentRecoveryCallbackUrls("https://api.healthfieldpharmacy.co.ke", "a-secure-callback-secret-at-least-24-characters");
  assert.deepEqual(buildTransactionStatusPayload({ initiatorName: "healthfield-api", securityCredential: "encrypted-value", shortcode: "4502013" }, " tgh7k2ab91 ", urls), {
    Initiator: "healthfield-api",
    SecurityCredential: "encrypted-value",
    CommandID: "TransactionStatusQuery",
    TransactionID: "TGH7K2AB91",
    PartyA: 4502013,
    IdentifierType: "4",
    ResultURL: urls.transactionStatusResultUrl,
    QueueTimeOutURL: urls.transactionStatusTimeoutUrl,
    Remarks: "Healthfield payment reconciliation",
    Occasion: "Payment verification",
  });
  assert.deepEqual(buildPullTransactionsQueryPayload("4502013", new Date("2026-08-14T05:00:00Z"), new Date("2026-08-14T06:00:00Z")), {
    ShortCode: 4502013,
    StartDate: "2026-08-14 08:00:00",
    EndDate: "2026-08-14 09:00:00",
    OffSetValue: "0",
  });
});

test("matches a unique Till payment by exact amount without using either phone number", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const candidate = selectIncomingPaymentCandidate({
    amount: "2450.00",
    orderNumber: "POS-ME8K-12AB",
    allowAmountOnly: true,
    now: now.getTime(),
    recent: [{ receiptNumber: "TGH7K2AB91", amount: "2450.00", accountReference: null, createdAt: new Date(now.getTime() - 60_000), phone: "254722000000" }],
  });
  assert.equal(candidate?.receiptNumber, "TGH7K2AB91");
});

test("does not guess when two recent Till payments have the same amount", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const recent = [
    { receiptNumber: "TGH7K2AB91", amount: "2450.00", accountReference: null, createdAt: new Date(now.getTime() - 60_000) },
    { receiptNumber: "TGH7K2AB92", amount: "2450.00", accountReference: null, createdAt: new Date(now.getTime() - 90_000) },
  ];
  assert.equal(selectIncomingPaymentCandidate({ amount: 2450, allowAmountOnly: true, now: now.getTime(), recent }), null);
});

test("exact order reference wins when equal-amount Till payments are ambiguous", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  const recent = [
    { receiptNumber: "TGH7K2AB91", amount: "2450.00", accountReference: "POS-ME8K-12AB", createdAt: now },
    { receiptNumber: "TGH7K2AB92", amount: "2450.00", accountReference: "OTHER", createdAt: now },
  ];
  assert.equal(selectIncomingPaymentCandidate({ amount: 2450, orderNumber: "POS-ME8K-12AB", allowAmountOnly: true, now: now.getTime(), recent })?.receiptNumber, "TGH7K2AB91");
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

test("uses the provider receipt or a bounded CheckoutRequestID reference for successful STK reconciliation", () => {
  assert.equal(stkReconciliationReference("ws_CO_140820260618123456", "uhebd338cw"), "UHEBD338CW");
  assert.equal(stkReconciliationReference("ws_CO_140820260618123456"), "STK-ws_CO_140820260618123456");
  assert.equal(stkReconciliationReference("x".repeat(140)).length, 100);
});

test("STK callback matching is independent of the customer or payer phone", () => {
  const parsed = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "merchant-1", CheckoutRequestID: "checkout-1", ResultCode: 0, ResultDesc: "Success", CallbackMetadata: { Item: [
    { Name: "Amount", Value: 5 },
    { Name: "MpesaReceiptNumber", Value: "UHEBD338CW" },
    { Name: "PhoneNumber", Value: 254799999999 },
  ] } } } });
  assert.equal(parsed.checkoutRequestId, "checkout-1");
  assert.equal(parsed.amount, 5);
  assert.equal(parsed.receiptNumber, "UHEBD338CW");
  assert.equal(parsed.phone, "254799999999");
});

test("backs off background STK reconciliation as a payment ages", () => {
  assert.equal(stkBackgroundReconcileDelay(30_000), 30_000);
  assert.equal(stkBackgroundReconcileDelay(5 * 60_000), 60_000);
  assert.equal(stkBackgroundReconcileDelay(30 * 60_000), 5 * 60_000);
});

test("extracts receipts and parses successful callbacks", () => {
  assert.equal(extractMpesaReceipt("Confirmed. M-PESA code TGH7K2AB91 paid"), "TGH7K2AB91");
  const parsed = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "c", ResultCode: 0, ResultDesc: "Success", CallbackMetadata: { Item: [{ Name: "Amount", Value: 1250 }, { Name: "MpesaReceiptNumber", Value: "TGH7K2AB91" }, { Name: "PhoneNumber", Value: 254712345678 }] } } } });
  assert.deepEqual(parsed, { checkoutRequestId: "c", merchantRequestId: "m", resultCode: "0", resultDescription: "Success", receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678" });
});

test("parses C2B till confirmations", () => {
  assert.deepEqual(parseC2bPayment({ TransID: "TGH7K2AB91", TransAmount: "1250.00", MSISDN: "254712345678", FirstName:"Jane", MiddleName:"W", LastName:"Njeri", BillRefNumber: "HF-123" }), { receiptNumber: "TGH7K2AB91", amount: 1250, phone: "254712345678", payerName:"Jane W Njeri", accountReference: "HF-123", transactionTime: null });
});

test("parses and deduplicates Pull Transactions response rows", () => {
  const parsed = parsePullTransactions({ Response: [
    { transactionId: "TGH7K2AB91", amount: "1250.00", msisdn: "2547*****678", trxDate: "2026-08-14 08:30:00", accountReference: "HF-123" },
    { TransID: "TGH7K2AB91", TransAmount: 1250 },
    { TransactionID: "TGH7K2AB92", TransactionAmount: 900, DebitPartyName: "Jane Njeri" },
  ] });
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { receiptNumber: "TGH7K2AB91", amount: 1250, phone: "2547*****678", payerName: null, accountReference: "HF-123", transactionTime: "2026-08-14 08:30:00" });
  assert.deepEqual(parsed[1], { receiptNumber: "TGH7K2AB92", amount: 900, phone: null, payerName: "Jane Njeri", accountReference: null, transactionTime: null });
});

test("parses successful asynchronous Transaction Status result parameters", () => {
  const parsed = parseTransactionStatusResult({ Result: { ResultCode: 0, ResultDesc: "The service request is processed successfully.", OriginatorConversationID: "status-request-1", ResultParameters: { ResultParameter: [
    { Key: "ReceiptNo", Value: "TGH7K2AB91" },
    { Key: "Amount", Value: "1250.00" },
    { Key: "DebitPartyName", Value: "Jane Njeri" },
    { Key: "FinalisedTime", Value: "20260814083000" },
  ] } } });
  assert.equal(parsed.successful, true);
  assert.equal(parsed.receiptNumber, "TGH7K2AB91");
  assert.equal(parsed.originatorConversationId, "status-request-1");
  assert.deepEqual(parsed.payment, { receiptNumber: "TGH7K2AB91", amount: 1250, phone: null, payerName: "Jane Njeri", accountReference: null, transactionTime: "20260814083000" });
});
