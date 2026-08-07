export type MpesaConfiguration = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  callbackSecret: string;
  callbackBaseUrl: string;
};

type JsonRecord = Record<string, unknown>;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function normalizeKenyanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  throw new Error("Enter a valid Safaricom phone number, for example 0712 345 678.");
}

export function mpesaConfiguration(): MpesaConfiguration | null {
  const consumerKey = process.env.MPESA_CONSUMER_KEY?.trim() || "";
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET?.trim() || "";
  const shortcode = process.env.MPESA_SHORTCODE?.trim() || "";
  const passkey = process.env.MPESA_PASSKEY?.trim() || "";
  const callbackSecret = process.env.MPESA_CALLBACK_SECRET?.trim() || "";
  const callbackBaseUrl = (process.env.MPESA_CALLBACK_BASE_URL || process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || callbackSecret.length < 24 || !/^https:\/\//i.test(callbackBaseUrl)) return null;
  return {
    baseUrl: (process.env.MPESA_BASE_URL || "https://api.safaricom.co.ke").replace(/\/$/, ""),
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    transactionType: process.env.MPESA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    callbackSecret,
    callbackBaseUrl,
  };
}

export function mpesaTimestamp(date = new Date()) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

export function mpesaPassword(shortcode: string, passkey: string, timestamp: string) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function extractMpesaReceipt(message: string) {
  const labelled = message.toUpperCase().match(/(?:M-?PESA\s+)?(?:CODE|RECEIPT|TRANSACTION)\s*[:#-]?\s*([A-Z0-9]{10,12})/i)?.[1];
  if (labelled) return labelled;
  return message.toUpperCase().match(/\b(?=[A-Z0-9]{10,12}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/)?.[0] || null;
}

async function mpesaJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(String(data.errorMessage || data.ResponseDescription || `M-Pesa returned HTTP ${response.status}.`));
  return data;
}

async function accessToken(config: MpesaConfiguration) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
  const data = await mpesaJson(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${credentials}` } });
  const value = String(data.access_token || "");
  if (!value) throw new Error("M-Pesa did not return an access token.");
  cachedToken = { value, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3599) * 1000 };
  return value;
}

export async function initiateStkPush(input: { orderNumber: string; phone: string; amount: number }) {
  const config = mpesaConfiguration();
  if (!config) throw new Error("M-Pesa Express is not configured.");
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !Number.isInteger(input.amount)) throw new Error("M-Pesa Express requires a whole Kenya-shilling amount.");
  const phone = normalizeKenyanPhone(input.phone);
  const timestamp = mpesaTimestamp();
  const token = await accessToken(config);
  const data = await mpesaJson(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: mpesaPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: config.transactionType,
      Amount: input.amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: `${config.callbackBaseUrl}/v1/payments/mpesa/stk/callback/${encodeURIComponent(config.callbackSecret)}`,
      AccountReference: input.orderNumber.slice(0, 12),
      TransactionDesc: `Healthfield ${input.orderNumber}`.slice(0, 20),
    }),
  });
  const checkoutRequestId = String(data.CheckoutRequestID || "");
  if (!checkoutRequestId || String(data.ResponseCode || "") !== "0") throw new Error(String(data.ResponseDescription || data.CustomerMessage || "M-Pesa could not start the payment request."));
  return { checkoutRequestId, merchantRequestId: String(data.MerchantRequestID || ""), customerMessage: String(data.CustomerMessage || "Check your phone to complete payment."), phone, providerPayload: data };
}

export async function queryStkPush(checkoutRequestId: string) {
  const config = mpesaConfiguration();
  if (!config) throw new Error("M-Pesa Express is not configured.");
  const timestamp = mpesaTimestamp();
  const token = await accessToken(config);
  return mpesaJson(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: config.shortcode, Password: mpesaPassword(config.shortcode, config.passkey, timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId }),
  });
}

export function parseStkCallback(payload: JsonRecord) {
  const body = payload.Body as JsonRecord | undefined;
  const callback = body?.stkCallback as JsonRecord | undefined;
  if (!callback) throw new Error("Invalid M-Pesa callback payload.");
  const items = ((callback.CallbackMetadata as JsonRecord | undefined)?.Item as Array<JsonRecord> | undefined) || [];
  const metadata = Object.fromEntries(items.map((item) => [String(item.Name || ""), item.Value]));
  return {
    checkoutRequestId: String(callback.CheckoutRequestID || ""),
    merchantRequestId: String(callback.MerchantRequestID || ""),
    resultCode: String(callback.ResultCode ?? ""),
    resultDescription: String(callback.ResultDesc || ""),
    receiptNumber: metadata.MpesaReceiptNumber ? String(metadata.MpesaReceiptNumber).toUpperCase() : null,
    amount: metadata.Amount === undefined ? null : Number(metadata.Amount),
    phone: metadata.PhoneNumber === undefined ? null : String(metadata.PhoneNumber),
  };
}

export function parseC2bPayment(payload: JsonRecord) {
  const receiptNumber = String(payload.TransID || payload.TransactionID || "").trim().toUpperCase();
  const amount = Number(payload.TransAmount ?? payload.Amount);
  if (!receiptNumber || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid M-Pesa C2B confirmation payload.");
  return { receiptNumber, amount, phone: String(payload.MSISDN || payload.PhoneNumber || "") || null, accountReference: String(payload.BillRefNumber || payload.AccountReference || "") || null, transactionTime: String(payload.TransTime || payload.TransactionTime || "") || null };
}
