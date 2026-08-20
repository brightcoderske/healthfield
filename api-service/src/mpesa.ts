export type MpesaConfiguration = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  partyB: string;
  passkey: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  callbackSecret: string;
  callbackBaseUrl: string;
};

type JsonRecord = Record<string, unknown>;

export type StkQueryOutcome = {
  state: "PAID" | "PENDING" | "FAILED";
  resultCode: string;
  resultDescription: string;
};

export type IncomingMpesaPayment = {
  receiptNumber: string;
  amount: number;
  phone: string | null;
  payerName: string | null;
  accountReference: string | null;
  transactionTime: string | null;
};

type TransactionStatusConfiguration = MpesaConfiguration & {
  initiatorName: string;
  securityCredential: string;
};

type PullTransactionsConfiguration = MpesaConfiguration & {
  nominatedNumber: string | null;
};

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
  const transactionType = process.env.MPESA_TRANSACTION_TYPE?.trim() || "";
  const partyB = transactionType === "CustomerBuyGoodsOnline" ? process.env.MPESA_PARTY_B?.trim() || "" : shortcode;
  const callbackSecret = process.env.MPESA_CALLBACK_SECRET?.trim() || "";
  const callbackBaseUrl = (process.env.MPESA_CALLBACK_BASE_URL || process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
  if (!consumerKey || !consumerSecret || !/^\d{5,8}$/.test(shortcode) || !/^\d{5,8}$/.test(partyB) || !passkey || !["CustomerPayBillOnline", "CustomerBuyGoodsOnline"].includes(transactionType) || callbackSecret.length < 24 || !/^https:\/\//i.test(callbackBaseUrl)) return null;
  return {
    baseUrl: (process.env.MPESA_BASE_URL || "https://api.safaricom.co.ke").replace(/\/$/, ""),
    consumerKey,
    consumerSecret,
    shortcode,
    partyB,
    passkey,
    transactionType: transactionType as MpesaConfiguration["transactionType"],
    callbackSecret,
    callbackBaseUrl,
  };
}

export function transactionStatusConfiguration(): TransactionStatusConfiguration | null {
  const config = mpesaConfiguration();
  const initiatorName = process.env.MPESA_INITIATOR_NAME?.trim() || "";
  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL?.trim() || "";
  return config && initiatorName && securityCredential ? { ...config, initiatorName, securityCredential } : null;
}

export function pullTransactionsConfiguration(): PullTransactionsConfiguration | null {
  const config = mpesaConfiguration();
  if (!config || process.env.MPESA_PULL_ENABLED?.trim().toLowerCase() !== "true") return null;
  const nominatedNumber = process.env.MPESA_PULL_NOMINATED_NUMBER?.replace(/\D/g, "") || null;
  if (nominatedNumber && !/^254[17]\d{8}$/.test(nominatedNumber)) return null;
  return { ...config, nominatedNumber };
}

export function mpesaTimestamp(date = new Date()) {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

export function mpesaPassword(shortcode: string, passkey: string, timestamp: string) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function buildStkNotificationUrl(baseUrl: string, secret: string) {
  return `${baseUrl.replace(/\/$/, "")}/v1/payments/mobile-money/stk/notification/${encodeURIComponent(secret)}`;
}

export function buildC2bCallbackUrls(baseUrl: string, secret: string) {
  const root = `${baseUrl.replace(/\/$/, "")}/v1/payments/mobile-money/c2b`;
  const encodedSecret = encodeURIComponent(secret);
  return {
    confirmationUrl: `${root}/confirmation/${encodedSecret}`,
    validationUrl: `${root}/verification/${encodedSecret}`,
  };
}

export function buildPaymentRecoveryCallbackUrls(baseUrl: string, secret: string) {
  const root = `${baseUrl.replace(/\/$/, "")}/v1/payments/mobile-money`;
  const encodedSecret = encodeURIComponent(secret);
  return {
    transactionStatusResultUrl: `${root}/status/result/${encodedSecret}`,
    transactionStatusTimeoutUrl: `${root}/status/timeout/${encodedSecret}`,
    pullNotificationUrl: `${root}/recovery/notification/${encodedSecret}`,
  };
}

export function normalizePaymentReference(value: string | null | undefined) {
  return (value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function paymentReferenceMatchesOrder(reference: string | null | undefined, orderNumber: string | null | undefined) {
  const incoming = normalizePaymentReference(reference);
  const order = normalizePaymentReference(orderNumber);
  return Boolean(incoming && order && (incoming === order || incoming === order.slice(0, 12)));
}

/**
 * How recent an unreferenced payment must be before its amount alone may match it.
 *
 * A Buy Goods till sends no account reference, so the amount is the only link back to
 * an order. Outside this window the coincidence of two equal amounts stops being
 * unlikely, and a match becomes a guess.
 */
export const AMOUNT_ONLY_MATCH_WINDOW_MS = 30 * 60_000;

export function selectIncomingPaymentCandidate<T extends { receiptNumber: string; amount: string | number; accountReference: string | null; createdAt: Date }>(input: {
  amount: string | number;
  receiptNumber?: string | null;
  orderNumber?: string | null;
  allowAmountOnly: boolean;
  recent: T[];
  now?: number;
}) {
  const amountMatches = input.recent.filter((row) => Math.abs(Number(row.amount) - Number(input.amount)) <= 0.001);
  const receiptMatch = input.receiptNumber ? amountMatches.find((row) => row.receiptNumber === input.receiptNumber) : null;
  if (receiptMatch) return receiptMatch;

  const referenceMatches = input.orderNumber
    ? amountMatches.filter((row) => paymentReferenceMatchesOrder(row.accountReference, input.orderNumber))
    : [];
  if (referenceMatches.length === 1) return referenceMatches[0];
  if (!input.allowAmountOnly) return null;

  const now = input.now ?? Date.now();
  const recentAmountMatches = amountMatches.filter((row) => now - row.createdAt.getTime() <= AMOUNT_ONLY_MATCH_WINDOW_MS);
  return recentAmountMatches.length === 1 ? recentAmountMatches[0] : null;
}

/** A payment awaiting money, as seen from an arriving Safaricom notification. */
export type MatchablePaymentTransaction = {
  id: number;
  method: string;
  channel: string;
  status: string;
  amount: string | number;
  receiptNumber: string | null;
  createdAt: Date;
  orderNumber: string | null;
};

/**
 * The mirror of selectIncomingPaymentCandidate, for the direction Safaricom pushes.
 *
 * One till payment has just landed and many orders may be waiting for money. Both
 * directions have to agree on what counts as a match, or an order matched by the
 * webhook could be contradicted by the customer's next poll — hence the shared window
 * and the same refuse-when-ambiguous rule.
 */
export function selectPaymentForIncoming<T extends MatchablePaymentTransaction>(input: {
  incoming: { receiptNumber: string; amount: number; accountReference: string | null };
  candidates: T[];
  now?: number;
}): T | null {
  const amountMatches = input.candidates.filter(
    (row) =>
      Math.abs(Number(row.amount) - input.incoming.amount) <= 0.001 &&
      // A settled STK payment is still matchable while it carries only a placeholder
      // receipt, because the real one arrives with this notification.
      (row.status !== "PAID" || Boolean(row.receiptNumber?.startsWith("STK-"))),
  );

  // A Paybill reference names the order outright, so it decides on its own.
  const referenceMatches = amountMatches.filter((row) => paymentReferenceMatchesOrder(input.incoming.accountReference, row.orderNumber));
  if (referenceMatches.length) return referenceMatches.length === 1 ? referenceMatches[0] : null;

  // A Buy Goods till carries no reference, so the amount is all Safaricom sends.
  //
  // That is only enough at the counter, where the seller watched the customer pay and
  // the sale was rung up seconds earlier. An online order is a stranger's money arriving
  // from somewhere else entirely, so it is matched by the receipt the customer pasted
  // and never by amount alone. Even at the counter this refuses to guess: two sales
  // owing the same amount both go to the seller rather than one being credited with the
  // other's money.
  const now = input.now ?? Date.now();
  const awaiting = amountMatches.filter(
    (row) =>
      row.channel === "POS" &&
      row.method === "MANUAL_MPESA" &&
      row.status !== "PAID" &&
      row.status !== "REFUNDED" &&
      // A seller who typed a different receipt is settling something else.
      (!row.receiptNumber || row.receiptNumber === input.incoming.receiptNumber) &&
      now - row.createdAt.getTime() <= AMOUNT_ONLY_MATCH_WINDOW_MS,
  );
  return awaiting.length === 1 ? awaiting[0] : null;
}

export function classifyStkQueryResult(payload: JsonRecord): StkQueryOutcome {
  const resultCode = String(payload.ResultCode ?? "").trim();
  const resultDescription = String(payload.ResultDesc || payload.errorMessage || payload.ResponseDescription || "").trim();
  if (isSuccessfulMpesaResponseCode(resultCode)) return { state: "PAID", resultCode, resultDescription };

  const normalizedDescription = resultDescription.toLowerCase();
  const explicitlyPending = [
    "transaction does not exist",
    "transaction is being processed",
    "request is being processed",
    "still processing",
    "pending",
  ].some((message) => normalizedDescription.includes(message));
  if (!resultCode || explicitlyPending) return { state: "PENDING", resultCode, resultDescription };

  // Known final customer/provider outcomes. Unknown codes stay pending so a
  // delayed provider notification cannot be contradicted by an eager query.
  const terminalCodes = new Set(["1", "1001", "1019", "1025", "1032", "1037", "2001"]);
  return { state: terminalCodes.has(resultCode) ? "FAILED" : "PENDING", resultCode, resultDescription };
}

export function stkReconciliationReference(checkoutRequestId: string, receiptNumber?: unknown) {
  const receipt = String(receiptNumber || "").trim().toUpperCase();
  if (receipt) return receipt;
  const checkout = checkoutRequestId.trim();
  if (!checkout) throw new Error("The STK payment has no CheckoutRequestID.");
  return `STK-${checkout.slice(-96)}`;
}

export function stkBackgroundReconcileDelay(ageMs: number) {
  if (ageMs < 2 * 60_000) return 30_000;
  if (ageMs < 15 * 60_000) return 60_000;
  return 5 * 60_000;
}

export function validDateOrNull(value: Date | null | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

export function buildStkPushPayload(config: MpesaConfiguration, input: { orderNumber: string; phone: string; amount: number }, timestamp: string) {
  const accountReference = input.orderNumber.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "Healthfield";
  return {
    BusinessShortCode: Number(config.shortcode),
    Password: mpesaPassword(config.shortcode, config.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: config.transactionType,
    Amount: input.amount,
    PartyA: Number(input.phone),
    PartyB: Number(config.partyB),
    PhoneNumber: Number(input.phone),
    CallBackURL: buildStkNotificationUrl(config.callbackBaseUrl, config.callbackSecret),
    AccountReference: accountReference,
    TransactionDesc: `Healthfield ${accountReference}`.slice(0, 13),
  };
}

export function extractMpesaReceipt(message: string) {
  const labelled = message.toUpperCase().match(/(?:M-?PESA\s+)?(?:CODE|RECEIPT|TRANSACTION)\s*[:#-]?\s*([A-Z0-9]{10,12})/i)?.[1];
  if (labelled) return labelled;
  return message.toUpperCase().match(/\b(?=[A-Z0-9]{10,12}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/)?.[0] || null;
}

async function mpesaJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    const message = String(data.errorMessage || data.ResponseDescription || `M-Pesa returned HTTP ${response.status}.`);
    console.warn("M-Pesa API request rejected", {
      endpoint: new URL(url).pathname,
      status: response.status,
      errorCode: String(data.errorCode || data.ResponseCode || data.ResultCode || ""),
      responseStatus: String(data.ResponseStatus || ""),
      message,
    });
    throw new Error(message);
  }
  return data;
}

export function isSuccessfulMpesaResponseCode(value: unknown) {
  return /^0+$/.test(String(value ?? "").trim());
}

function acceptedRequest(data: JsonRecord, fallback: string) {
  const responseCode = data.ResponseCode ?? data.responseCode;
  if (responseCode !== undefined && !isSuccessfulMpesaResponseCode(responseCode)) {
    const code = String(responseCode).trim();
    const description = String(data.ResponseDescription || data.ResultDesc || data.errorMessage || fallback);
    throw new Error(code ? `${description} (${code})` : description);
  }
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
  console.info("Submitting M-Pesa STK request", { orderNumber: input.orderNumber, amount: input.amount, transactionType: config.transactionType, shortcodeSuffix: config.shortcode.slice(-4), partyBSuffix: config.partyB.slice(-4), phoneSuffix: phone.slice(-3) });
  const token = await accessToken(config);
  const data = await mpesaJson(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildStkPushPayload(config, { ...input, phone }, timestamp)),
  });
  const checkoutRequestId = String(data.CheckoutRequestID || "");
  const merchantRequestId = String(data.MerchantRequestID || "");
  const responseCode = String(data.ResponseCode || "");
  if (!checkoutRequestId || !isSuccessfulMpesaResponseCode(responseCode)) {
    console.warn("M-Pesa STK request was not accepted", { orderNumber: input.orderNumber, responseCode, responseDescription: String(data.ResponseDescription || "") });
    throw new Error(String(data.ResponseDescription || data.CustomerMessage || "M-Pesa could not start the payment request."));
  }
  console.info("M-Pesa STK request accepted", { orderNumber: input.orderNumber, responseCode, merchantRequestId, checkoutRequestId });
  return { checkoutRequestId, merchantRequestId, customerMessage: String(data.CustomerMessage || "Check your phone to complete payment."), phone, providerPayload: data };
}

export async function queryStkPush(checkoutRequestId: string) {
  const config = mpesaConfiguration();
  if (!config) throw new Error("M-Pesa Express is not configured.");
  const timestamp = mpesaTimestamp();
  const token = await accessToken(config);
  return mpesaJson(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: Number(config.shortcode), Password: mpesaPassword(config.shortcode, config.passkey, timestamp), Timestamp: timestamp, CheckoutRequestID: checkoutRequestId }),
  });
}

export async function queryTransactionStatus(transactionId: string) {
  const config = transactionStatusConfiguration();
  if (!config) throw new Error("M-Pesa Transaction Status is not configured.");
  const token = await accessToken(config);
  const urls = buildPaymentRecoveryCallbackUrls(config.callbackBaseUrl, config.callbackSecret);
  return acceptedRequest(await mpesaJson(`${config.baseUrl}/mpesa/transactionstatus/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildTransactionStatusPayload(config, transactionId, urls)),
  }), "Safaricom did not accept the Transaction Status request.");
}

export function buildTransactionStatusPayload(config: Pick<TransactionStatusConfiguration, "initiatorName" | "securityCredential" | "shortcode">, transactionId: string, urls: ReturnType<typeof buildPaymentRecoveryCallbackUrls>) {
  return {
    Initiator: config.initiatorName,
    SecurityCredential: config.securityCredential,
    CommandID: "TransactionStatusQuery",
    TransactionID: transactionId.trim().toUpperCase(),
    PartyA: Number(config.shortcode),
    IdentifierType: "4",
    ResultURL: urls.transactionStatusResultUrl,
    QueueTimeOutURL: urls.transactionStatusTimeoutUrl,
    Remarks: "Healthfield payment reconciliation",
    Occasion: "Payment verification",
  };
}

function pullDate(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function buildPullTransactionsQueryPayload(shortcode: string, start: Date, end: Date, offset = 0) {
  return { ShortCode: shortcode.trim(), StartDate: pullDate(start), EndDate: pullDate(end), OffSetValue: String(Math.max(0, Math.trunc(offset))) };
}

export async function queryPulledTransactions(start: Date, end: Date, offset = 0) {
  const config = pullTransactionsConfiguration();
  if (!config) throw new Error("M-Pesa Pull Transactions is not configured.");
  if (!(start instanceof Date) || !(end instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error("Enter a valid Pull Transactions date range.");
  if (end.getTime() - start.getTime() > 24 * 60 * 60_000) throw new Error("Pull Transactions is limited to a 24-hour recovery window.");
  const token = await accessToken(config);
  return acceptedRequest(await mpesaJson(`${config.baseUrl}/pulltransactions/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildPullTransactionsQueryPayload(config.shortcode, start, end, offset)),
  }), "Safaricom did not accept the Pull Transactions request.");
}

/**
 * Words Safaricom's C2B gateway refuses to deliver to.
 *
 * From the Daraja C2B documentation, FAQ 8 ("Why am I not receiving notifications"):
 * URLs containing mpesa, safaricom, exe, exec, cmd, sql or query — "or any of their
 * variants" — are silently not called, as are public tunnels. This matters most for the
 * callback secret, which is a random string sitting in the path: a rotation that
 * happens to contain "exe" or "cmd" would kill every callback with nothing to see.
 */
const FORBIDDEN_CALLBACK_WORDS = ["mpesa", "m-pesa", "safaricom", "exec", "exe", "cmd", "sql", "query", "ngrok", "mockbin", "requestbin"];

export function forbiddenCallbackWord(...urls: string[]) {
  for (const url of urls) {
    const value = url.toLowerCase();
    const found = FORBIDDEN_CALLBACK_WORDS.find((word) => value.includes(word));
    if (found) return found;
  }
  return null;
}

/**
 * Tells Safaricom where to deliver Till payments.
 *
 * Without this call the confirmation and validation endpoints exist and answer, but
 * nothing ever reaches them: Safaricom only posts to URLs registered against the
 * shortcode. Registration is not part of a deploy — it is a one-off per shortcode, and
 * has to be repeated whenever the callback host, the callback secret or the Daraja app
 * changes, because each of those changes the URL Safaricom holds.
 *
 * For a Buy Goods till the shortcode registered is the store (head office) number, not
 * the till the customer types; MPESA_C2B_SHORTCODE overrides it when Safaricom has
 * provisioned C2B against a different number.
 *
 * The API version is a setting because both versions answer ResponseCode 0 and take the
 * same payload, yet a shortcode provisioned under v1 can accept a v2 registration and
 * never deliver a callback. MPESA_C2B_API_VERSION=v1 makes that a two-minute experiment
 * rather than a support ticket.
 */
export async function registerC2bUrls() {
  const config = mpesaConfiguration();
  if (!config) throw new Error("M-Pesa is not configured, so there are no callback URLs to register.");
  const shortcode = process.env.MPESA_C2B_SHORTCODE?.trim() || config.shortcode;
  if (!/^\d{5,8}$/.test(shortcode)) throw new Error("MPESA_C2B_SHORTCODE must be the numeric shortcode C2B is provisioned against.");
  const version = process.env.MPESA_C2B_API_VERSION?.trim().toLowerCase() === "v1" ? "v1" : "v2";
  const urls = buildC2bCallbackUrls(config.callbackBaseUrl, config.callbackSecret);
  const forbidden = forbiddenCallbackWord(urls.confirmationUrl, urls.validationUrl);
  // Registration would succeed and deliver nothing, which is the worst of both.
  if (forbidden) throw new Error(`The callback URL contains "${forbidden}", which Safaricom will not deliver to. Change MPESA_CALLBACK_SECRET or MPESA_CALLBACK_BASE_URL so neither URL contains it.`);
  const token = await accessToken(config);
  const data = acceptedRequest(await mpesaJson(`${config.baseUrl}/mpesa/c2b/${version}/registerurl`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ShortCode: Number(shortcode),
      ResponseType: "Completed",
      ConfirmationURL: urls.confirmationUrl,
      ValidationURL: urls.validationUrl,
    }),
  }), "Safaricom did not register the C2B callback URLs.");
  return {
    shortcode,
    version,
    responseCode: String(data.ResponseCode ?? data.responseCode ?? ""),
    responseDescription: String(data.ResponseDescription || data.ResponseDesc || "C2B callback URLs registered."),
    confirmationUrl: urls.confirmationUrl,
    validationUrl: urls.validationUrl,
  };
}

export async function registerPullTransactionsCallback() {
  const config = pullTransactionsConfiguration();
  if (!config?.nominatedNumber) throw new Error("Set MPESA_PULL_NOMINATED_NUMBER before registering Pull Transactions.");
  const token = await accessToken(config);
  const urls = buildPaymentRecoveryCallbackUrls(config.callbackBaseUrl, config.callbackSecret);
  return acceptedRequest(await mpesaJson(`${config.baseUrl}/pulltransactions/v1/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ShortCode: config.shortcode, RequestType: "Pull", NominatedNumber: config.nominatedNumber, CallBackURL: urls.pullNotificationUrl }),
  }), "Safaricom did not register the Pull Transactions callback.");
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

export function parseC2bPayment(payload: JsonRecord): IncomingMpesaPayment {
  const receiptNumber = String(payload.TransID || payload.TransactionID || "").trim().toUpperCase();
  const amount = Number(payload.TransAmount ?? payload.Amount);
  if (!receiptNumber || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid M-Pesa C2B confirmation payload.");
  const payerName = [payload.FirstName, payload.MiddleName, payload.LastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ") || String(payload.PayerName || "").trim() || null;
  return { receiptNumber, amount, phone: String(payload.MSISDN || payload.PhoneNumber || "") || null, payerName, accountReference: String(payload.BillRefNumber || payload.AccountReference || "") || null, transactionTime: String(payload.TransTime || payload.TransactionTime || "") || null };
}

function valueOf(record: JsonRecord, names: string[]) {
  for (const name of names) if (record[name] !== undefined && record[name] !== null && String(record[name]).trim()) return record[name];
  return undefined;
}

function normalizePulledPayment(record: JsonRecord): IncomingMpesaPayment | null {
  const transactionType = String(valueOf(record, ["TransactionType", "transactionType", "Type", "type"]) || "").trim().toLowerCase();
  if (transactionType && !["c2b", "customer", "buy good", "pay bill", "paybill", "merchant payment", "payment received"].some((kind) => transactionType.includes(kind))) return null;
  const receiptNumber = String(valueOf(record, ["TransID", "TransactionID", "transactionId", "ReceiptNo", "receiptNumber", "MpesaReceiptNumber"]) || "").trim().toUpperCase();
  const amount = Number(valueOf(record, ["TransAmount", "TransactionAmount", "Amount", "amount"]));
  if (!/^[A-Z0-9]{8,100}$/.test(receiptNumber) || !Number.isFinite(amount) || amount <= 0) return null;
  const payerName = String(valueOf(record, ["PayerName", "payerName", "DebitPartyName", "debitPartyName"]) || "").trim()
    || [record.FirstName, record.MiddleName, record.LastName].map((value) => String(value || "").trim()).filter(Boolean).join(" ")
    || null;
  return {
    receiptNumber,
    amount,
    phone: String(valueOf(record, ["MSISDN", "PhoneNumber", "msisdn", "phoneNumber"]) || "").trim() || null,
    payerName,
    accountReference: String(valueOf(record, ["BillRefNumber", "AccountReference", "accountReference", "billRefNumber"]) || "").trim() || null,
    transactionTime: String(valueOf(record, ["TransTime", "TransactionTime", "transactionTime", "trxDate"]) || "").trim() || null,
  };
}

export function parsePullTransactions(payload: JsonRecord) {
  const rows: JsonRecord[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    if (typeof value !== "object") return;
    const record = value as JsonRecord;
    if (normalizePulledPayment(record)) rows.push(record);
    else for (const nested of Object.values(record)) if (Array.isArray(nested) || (nested && typeof nested === "object")) visit(nested, depth + 1);
  };
  visit(payload, 0);
  const unique = new Map<string, IncomingMpesaPayment>();
  for (const row of rows) { const payment = normalizePulledPayment(row); if (payment && !unique.has(payment.receiptNumber)) unique.set(payment.receiptNumber, payment); }
  return [...unique.values()];
}

export function parseTransactionStatusResult(payload: JsonRecord) {
  const result = (payload.Result && typeof payload.Result === "object" ? payload.Result : payload) as JsonRecord;
  const parametersContainer = result.ResultParameters && typeof result.ResultParameters === "object" ? result.ResultParameters as JsonRecord : {};
  const parameters = Array.isArray(parametersContainer.ResultParameter) ? parametersContainer.ResultParameter as JsonRecord[] : [];
  const values: JsonRecord = {};
  for (const parameter of parameters) {
    const key = String(parameter.Key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (key) values[key] = parameter.Value;
  }
  const receiptNumber = String(valueOf(values, ["receiptno", "transactionid", "transactionreceipt", "mpesareceiptnumber"]) || valueOf(result, ["TransactionID", "ReceiptNo"]) || "").trim().toUpperCase();
  const amountValue = valueOf(values, ["amount", "transactionamount"]);
  const amount = amountValue === undefined ? null : Number(amountValue);
  const resultCode = String(result.ResultCode ?? payload.ResultCode ?? "");
  const resultDescription = String(result.ResultDesc || payload.ResultDesc || "");
  const originatorConversationId = String(result.OriginatorConversationID || payload.OriginatorConversationID || "").trim() || null;
  return {
    successful: isSuccessfulMpesaResponseCode(resultCode),
    resultCode,
    resultDescription,
    originatorConversationId,
    receiptNumber: receiptNumber || null,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    payment: receiptNumber && amount !== null && Number.isFinite(amount) && amount > 0 ? normalizePulledPayment({
      TransactionID: receiptNumber,
      Amount: amount,
      DebitPartyName: valueOf(values, ["debitpartyname"]),
      MSISDN: valueOf(values, ["msisdn", "phonenumber"]),
      AccountReference: valueOf(values, ["accountreference", "billrefnumber"]),
      TransactionTime: valueOf(values, ["finalisedtime", "transactiontime"]),
    }) : null,
  };
}
