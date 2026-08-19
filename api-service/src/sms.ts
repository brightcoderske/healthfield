import { and, desc, eq, gte, isNotNull, inArray, sql } from "drizzle-orm";
import { smsMessages } from "../../db/schema";
import { getDb } from "./db";
import {
  isTransactional,
  smsRecipients,
  smsSegments,
  toGsm7,
  type SmsPurpose,
} from "../../lib/sms-templates";

/**
 * Celcom Africa bulk SMS transport.
 *
 * Their API is a plain JSON POST carrying the credentials in the body — no bearer
 * token, no signature — so the key must never reach the browser. Everything here runs
 * on the API service only.
 *
 * Endpoints and field names come from their developer documentation:
 *   send    POST https://isms.celcomafrica.com/api/services/sendsms/
 *   dlr     POST https://isms.celcomafrica.com/api/services/getdlr/
 *   balance POST https://isms.celcomafrica.com/api/services/getbalance/
 */

const DEFAULT_SEND_URL = "https://isms.celcomafrica.com/api/services/sendsms/";
const DEFAULT_DLR_URL = "https://isms.celcomafrica.com/api/services/getdlr/";
const DEFAULT_BALANCE_URL = "https://isms.celcomafrica.com/api/services/getbalance/";

export type SmsConfiguration = {
  sendUrl: string;
  dlrUrl: string;
  balanceUrl: string;
  apiKey: string;
  partnerId: string;
  /**
   * Celcom issues two sender IDs on one account: one cleared for transactional traffic,
   * one for promotional. The key is shared; only the sender ID differs.
   */
  transactionalSenderId: string;
  promotionalSenderId: string;
  /** Marketing may be switched off independently of transactional traffic. */
  marketingEnabled: boolean;
  transactionalEnabled: boolean;
  /** Every send is logged and skipped, for testing without spending credits. */
  dryRun: boolean;
};

export function smsConfiguration(): SmsConfiguration | null {
  const apiKey = (process.env.CELCOM_SMS_API_KEY || "").trim();
  const partnerId = (process.env.CELCOM_SMS_PARTNER_ID || "").trim();
  // A single CELCOM_SMS_SENDER_ID still works as a fallback for both, so an account
  // that has only been issued one ID so far is not blocked from sending.
  const fallbackSenderId = (process.env.CELCOM_SMS_SENDER_ID || "").trim();
  const transactionalSenderId = (process.env.CELCOM_SMS_SENDER_ID_TRANSACTIONAL || fallbackSenderId).trim();
  const promotionalSenderId = (process.env.CELCOM_SMS_SENDER_ID_PROMOTIONAL || fallbackSenderId).trim();
  // Credentials plus at least one sender ID; a partial configuration would otherwise
  // fail per message with 4091 or 4092 rather than declaring itself unconfigured here.
  if (!apiKey || !partnerId || (!transactionalSenderId && !promotionalSenderId)) return null;
  return {
    sendUrl: (process.env.CELCOM_SMS_SEND_URL || DEFAULT_SEND_URL).trim(),
    dlrUrl: (process.env.CELCOM_SMS_DLR_URL || DEFAULT_DLR_URL).trim(),
    balanceUrl: (process.env.CELCOM_SMS_BALANCE_URL || DEFAULT_BALANCE_URL).trim(),
    apiKey,
    partnerId,
    transactionalSenderId,
    promotionalSenderId,
    marketingEnabled: process.env.CELCOM_SMS_MARKETING_ENABLED !== "false",
    transactionalEnabled: process.env.CELCOM_SMS_TRANSACTIONAL_ENABLED !== "false",
    dryRun: process.env.CELCOM_SMS_DRY_RUN === "true",
  };
}

/** Celcom's documented return codes, so a failure is reported in words. */
const RETURN_CODES: Record<string, string> = {
  "200": "Success",
  "1001": "Invalid sender ID — the shortcode is not registered on this account.",
  "1002": "Network not allowed for this account.",
  "1003": "Invalid mobile number.",
  "1004": "Low bulk credits — top up the Celcom account.",
  "1005": "Celcom system error.",
  "1006": "Invalid credentials — check the API key and partner ID.",
  "1007": "Celcom system error.",
  "1008": "No delivery report available yet.",
  "1009": "Unsupported data type.",
  "1010": "Unsupported request type.",
  "4090": "Celcom internal error — retry after five minutes.",
  "4091": "No partner ID was sent.",
  "4092": "No API key was sent.",
  "4093": "Details not found.",
};

/**
 * Which sender ID a message goes out under.
 *
 * Decided from the purpose alone, never from anything a user typed. Promotional traffic
 * sent under a transactional ID is exactly what gets a sender ID revoked, so this is
 * not something an operator is given the option to get wrong.
 */
export function senderIdFor(configuration: SmsConfiguration, purpose: SmsPurpose) {
  return isTransactional(purpose)
    ? configuration.transactionalSenderId || configuration.promotionalSenderId
    : configuration.promotionalSenderId || configuration.transactionalSenderId;
}

export function describeSmsCode(code: string | number | undefined | null) {
  const key = String(code ?? "").trim();
  return RETURN_CODES[key] ?? (key ? `Celcom returned code ${key}.` : "Celcom returned no code.");
}

type CelcomResponseRow = {
  // Their payload really does misspell this key; the correct spelling is accepted too
  // in case they ever fix it, so this keeps working either way.
  "respose-code"?: number | string;
  "response-code"?: number | string;
  "response-description"?: string;
  mobile?: number | string;
  messageid?: number | string;
  networkid?: string;
};

export type SmsResult = {
  recipient: string;
  ok: boolean;
  messageId: string | null;
  code: string;
  detail: string;
};

/**
 * Records what was attempted and what the gateway said.
 *
 * Never allowed to fail a send: the message has already gone out by this point, so a
 * logging problem must not be reported to the caller as a delivery problem.
 */
async function logSmsResults(input: {
  results: SmsResult[];
  message: string;
  purpose: SmsPurpose;
  senderId: string;
  segmentsEach: number;
  orderId?: number | null;
  campaignId?: number | null;
}) {
  if (!input.results.length) return;
  try {
    await getDb().insert(smsMessages).values(input.results.map((result) => ({
      recipient: result.recipient.slice(0, 20),
      purpose: input.purpose,
      senderId: input.senderId.slice(0, 30),
      channel: isTransactional(input.purpose) ? "TRANSACTIONAL" as const : "PROMOTIONAL" as const,
      message: input.message,
      segments: input.segmentsEach,
      providerMessageId: result.messageId,
      // "Sent" is all the send call can tell us; delivery is only known from a report.
      status: result.ok ? "SENT" as const : "FAILED" as const,
      responseCode: result.code || null,
      detail: result.detail.slice(0, 255),
      orderId: input.orderId ?? null,
      campaignId: input.campaignId ?? null,
    })));
  } catch (error) {
    console.error("SMS log write failed", error);
  }
}

export type SmsSendOutcome = {
  sent: number;
  failed: number;
  skipped: string | null;
  segments: number;
  results: SmsResult[];
};

async function postJson(url: string, body: Record<string, unknown>, timeoutMs = 15_000) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Celcom returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Celcom returned a non-JSON response: ${text.slice(0, 300)}`);
  }
}

/**
 * Sends one message to one or many recipients.
 *
 * Never throws for a delivery failure: a customer's order must not fail because an SMS
 * gateway is down or out of credit. The caller gets a per-recipient result and decides
 * what, if anything, is worth surfacing.
 */
export async function sendSms(input: {
  to: string | Array<string | null | undefined>;
  message: string;
  purpose: SmsPurpose;
  /** Unix timestamp or "YYYY-MM-DD HH:mm" to queue the message for later. */
  timeToSend?: string | number;
  /** Recorded on the log row so a report can be traced back to what caused it. */
  orderId?: number | null;
  campaignId?: number | null;
}): Promise<SmsSendOutcome> {
  const empty = (skipped: string): SmsSendOutcome => ({ sent: 0, failed: 0, skipped, segments: 0, results: [] });
  const configuration = smsConfiguration();
  if (!configuration) return empty("SMS is not configured.");
  if (isTransactional(input.purpose) && !configuration.transactionalEnabled) return empty("Transactional SMS is switched off.");
  if (!isTransactional(input.purpose) && !configuration.marketingEnabled) return empty("Marketing SMS is switched off.");

  if (!senderIdFor(configuration, input.purpose)) {
    return empty(isTransactional(input.purpose)
      ? "No transactional sender ID is configured."
      : "No promotional sender ID is configured.");
  }
  const recipients = smsRecipients(Array.isArray(input.to) ? input.to : [input.to]);
  if (!recipients.length) return empty("No valid recipient.");
  const message = toGsm7(input.message);
  if (!message) return empty("The message was empty once unsupported characters were removed.");
  const segments = smsSegments(message) * recipients.length;

  if (configuration.dryRun) {
    console.info("SMS dry run", { purpose: input.purpose, recipients: recipients.length, segments, message });
    return { sent: 0, failed: 0, skipped: "Dry run — no message was sent.", segments, results: [] };
  }

  try {
    const payload: Record<string, unknown> = {
      apikey: configuration.apiKey,
      partnerID: configuration.partnerId,
      shortcode: senderIdFor(configuration, input.purpose),
      // Their API takes a comma-separated list for a bulk send.
      mobile: recipients.join(","),
      message,
      pass_type: "plain",
    };
    if (input.timeToSend) payload.timeToSend = input.timeToSend;
    const body = await postJson(configuration.sendUrl, payload) as { responses?: CelcomResponseRow[] };
    const rows = Array.isArray(body?.responses) ? body.responses : [];
    const results: SmsResult[] = rows.map((row, index) => {
      const code = String(row["respose-code"] ?? row["response-code"] ?? "").trim();
      return {
        recipient: String(row.mobile ?? recipients[index] ?? ""),
        ok: code === "200",
        messageId: row.messageid === undefined || row.messageid === null ? null : String(row.messageid),
        code,
        detail: row["response-description"] || describeSmsCode(code),
      };
    });
    // A response with no rows at all is a failure, not a silent success.
    if (!results.length) {
      return { sent: 0, failed: recipients.length, skipped: null, segments, results: recipients.map((recipient) => ({ recipient, ok: false, messageId: null, code: "", detail: "Celcom returned no per-message response." })) };
    }
    const sent = results.filter((result) => result.ok).length;
    await logSmsResults({
      results, message, purpose: input.purpose,
      senderId: senderIdFor(configuration, input.purpose),
      segmentsEach: smsSegments(message),
      orderId: input.orderId, campaignId: input.campaignId,
    });
    return { sent, failed: results.length - sent, skipped: null, segments, results };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The SMS gateway could not be reached.";
    console.error("SMS send failed", { purpose: input.purpose, recipients: recipients.length, detail });
    return { sent: 0, failed: recipients.length, skipped: null, segments, results: recipients.map((recipient) => ({ recipient, ok: false, messageId: null, code: "", detail })) };
  }
}

/** Fire-and-forget send for paths where the SMS must never delay the response. */
export function queueSms(input: Parameters<typeof sendSms>[0]) {
  void sendSms(input).catch((error) => console.error("Queued SMS failed", error));
}

export async function smsDeliveryReport(messageId: string) {
  const configuration = smsConfiguration();
  if (!configuration) return null;
  try {
    return await postJson(configuration.dlrUrl, {
      apikey: configuration.apiKey,
      partnerID: configuration.partnerId,
      messageID: messageId,
    });
  } catch (error) {
    console.error("SMS delivery report failed", { messageId, error });
    return null;
  }
}

/**
 * Remaining SMS credit.
 *
 * Worth surfacing in admin: code 1004 means the pharmacy has silently stopped being
 * able to notify anyone, and nothing else in the system would reveal that.
 */
export async function smsBalance() {
  const configuration = smsConfiguration();
  if (!configuration) return null;
  try {
    return await postJson(configuration.balanceUrl, {
      apikey: configuration.apiKey,
      partnerID: configuration.partnerId,
    });
  } catch (error) {
    console.error("SMS balance check failed", { error });
    return null;
  }
}

export function smsConfigurationSummary() {
  const configuration = smsConfiguration();
  return {
    configured: Boolean(configuration),
    transactionalSenderId: configuration?.transactionalSenderId || null,
    promotionalSenderId: configuration?.promotionalSenderId || null,
    marketingEnabled: configuration?.marketingEnabled ?? false,
    transactionalEnabled: configuration?.transactionalEnabled ?? false,
    dryRun: configuration?.dryRun ?? false,
  };
}


export type SmsReportRow = {
  id: number;
  recipient: string;
  purpose: string;
  channel: "TRANSACTIONAL" | "PROMOTIONAL";
  message: string;
  segments: number;
  providerMessageId: string | null;
  status: string;
  responseCode: string | null;
  detail: string | null;
  createdAt: Date;
};

/** Recent traffic plus the counts a shop actually acts on. */
export async function smsReport(limit = 200) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [rows, totals, spend] = await Promise.all([
    db.select({
      id: smsMessages.id, recipient: smsMessages.recipient, purpose: smsMessages.purpose,
      channel: smsMessages.channel, message: smsMessages.message, segments: smsMessages.segments,
      providerMessageId: smsMessages.providerMessageId, status: smsMessages.status,
      responseCode: smsMessages.responseCode, detail: smsMessages.detail, createdAt: smsMessages.createdAt,
    }).from(smsMessages).orderBy(desc(smsMessages.createdAt)).limit(Math.min(limit, 500)),
    db.select({ status: smsMessages.status, count: sql<number>`count(*)` })
      .from(smsMessages).where(gte(smsMessages.createdAt, since)).groupBy(smsMessages.status),
    db.select({ channel: smsMessages.channel, segments: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
      .from(smsMessages).where(gte(smsMessages.createdAt, since)).groupBy(smsMessages.channel),
  ]);
  return {
    messages: rows,
    // Segments, not messages: a long message is billed more than once, so this is what
    // actually draws down the credit balance.
    last30Days: {
      byStatus: Object.fromEntries(totals.map((row) => [row.status, Number(row.count)])),
      segmentsByChannel: Object.fromEntries(spend.map((row) => [row.channel, Number(row.segments)])),
    },
  };
}

/**
 * Asks Celcom what happened to messages still marked as merely sent.
 *
 * Capped per run so a backlog cannot turn one admin page load into hundreds of calls.
 */
export async function refreshSmsDeliveryReports(limit = 25) {
  const configuration = smsConfiguration();
  if (!configuration) return { checked: 0, updated: 0 };
  const db = getDb();
  const pending = await db.select({ id: smsMessages.id, providerMessageId: smsMessages.providerMessageId })
    .from(smsMessages)
    .where(and(inArray(smsMessages.status, ["SENT", "PENDING"]), isNotNull(smsMessages.providerMessageId)))
    .orderBy(desc(smsMessages.createdAt))
    .limit(limit);
  let updated = 0;
  for (const row of pending) {
    const report = await smsDeliveryReport(String(row.providerMessageId)) as Record<string, unknown> | null;
    const text = JSON.stringify(report ?? {}).toLowerCase();
    // Their delivery payload is not documented field by field, so the status is read
    // from the words it contains rather than a shape that might not hold.
    const status = /deliver(ed)?"|"delivrd|"success/.test(text) && !/undeliver/.test(text)
      ? "DELIVERED" as const
      : /undeliver|failed|expired|reject/.test(text)
        ? "UNDELIVERED" as const
        : null;
    await db.update(smsMessages).set({
      status: status ?? undefined,
      detail: typeof report === "object" && report ? JSON.stringify(report).slice(0, 255) : undefined,
      deliveredAtMs: status === "DELIVERED" ? Date.now() : undefined,
      lastCheckedAtMs: Date.now(),
    }).where(eq(smsMessages.id, row.id));
    if (status) updated += 1;
  }
  return { checked: pending.length, updated };
}

/** Where an administrator is sent to buy more credit. */
export function smsTopUpUrl() {
  return (process.env.CELCOM_SMS_TOPUP_URL || "https://celcomafrica.com").trim();
}


/**
 * A small summary for the admin dashboard card.
 *
 * Deliberately does not call Celcom: the dashboard loads on every admin visit, and a
 * balance lookup per page view would be a network round trip nobody asked for. The
 * balance lives on the reports page, behind an intentional visit.
 */
export async function smsDashboardSummary() {
  const configuration = smsConfiguration();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  try {
    const rows = await getDb()
      .select({ status: smsMessages.status, segments: sql<number>`coalesce(sum(${smsMessages.segments}), 0)`, count: sql<number>`count(*)` })
      .from(smsMessages)
      .where(gte(smsMessages.createdAt, since))
      .groupBy(smsMessages.status);
    const total = rows.reduce((sum, row) => sum + Number(row.segments), 0);
    const failed = rows
      .filter((row) => row.status === "FAILED" || row.status === "UNDELIVERED")
      .reduce((sum, row) => sum + Number(row.count), 0);
    return {
      configured: Boolean(configuration),
      promotionalReady: Boolean(configuration?.promotionalSenderId),
      segments30Days: total,
      failed30Days: failed,
    };
  } catch {
    return { configured: Boolean(configuration), promotionalReady: Boolean(configuration?.promotionalSenderId), segments30Days: 0, failed30Days: 0 };
  }
}
