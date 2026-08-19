/**
 * SMS message construction: recipients, GSM-7 safety, segment counting, and the
 * wording of every message the pharmacy sends.
 *
 * Pure functions only, so the exact text that will reach a customer can be asserted in
 * tests without a provider, an account balance, or a network. The transport that
 * actually delivers these lives in api-service/src/sms.ts.
 *
 * Written without constructor parameter properties or enums: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export const smsPurposes = [
  "ORDER_RECEIVED",
  "POS_SALE_COMPLETE",
  "ORDER_READY_FOR_PICKUP",
  "ORDER_OUT_FOR_DELIVERY",
  "PAYMENT_CONFIRMED",
  "CASH_ON_DELIVERY_DUE",
  "OTP",
  "MARKETING",
] as const;

export type SmsPurpose = (typeof smsPurposes)[number];

/**
 * Transactional messages must go out even when marketing is paused, and marketing must
 * never ride on a transactional consent. Keeping the split explicit stops one becoming
 * the other by accident.
 */
export function isTransactional(purpose: SmsPurpose) {
  return purpose !== "MARKETING";
}

/**
 * A phone number in the 254XXXXXXXXX form Celcom expects, or null.
 *
 * Non-throwing on purpose: a bulk send with one malformed number in the list should
 * drop that number, not abandon the whole campaign.
 */
export function smsRecipient(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

/** Deduplicated, valid recipients, preserving the order they were given in. */
export function smsRecipients(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const value of values) {
    const recipient = smsRecipient(value);
    if (recipient) seen.add(recipient);
  }
  return [...seen];
}

// The GSM 03.38 basic set. Anything outside it forces the whole message into UCS-2,
// which cuts the per-segment allowance from 160 characters to 70.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// These cost two characters each rather than one.
const GSM7_EXTENDED = "^{}\\[~]|€";

// Characters a copywriter or a rich-text paste routinely introduces, each of which
// would silently halve the segment length if it survived into the payload.
const SUBSTITUTIONS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-",
  "…": "...", " ": " ", "•": "-", "·": "-",
  "×": "x", "™": "TM", "®": "", "©": "",
  "ʼ": "'", "‟": '"', "‹": "<", "›": ">",
};

/**
 * Rewrites a message into characters Celcom will accept, dropping anything that has no
 * GSM-7 equivalent rather than letting it degrade the whole send.
 */
export function toGsm7(message: string) {
  let out = "";
  for (const character of message.replace(/\r\n/g, "\n")) {
    const mapped = SUBSTITUTIONS[character] ?? character;
    for (const candidate of mapped) {
      if (GSM7_BASIC.includes(candidate) || GSM7_EXTENDED.includes(candidate)) out += candidate;
      // Everything else — emoji, non-Latin scripts, stray symbols — is dropped.
    }
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

/** Billable length: extended characters count twice. */
export function gsm7Length(message: string) {
  let length = 0;
  for (const character of message) length += GSM7_EXTENDED.includes(character) ? 2 : 1;
  return length;
}

/** How many messages the customer is charged for. */
export function smsSegments(message: string) {
  const length = gsm7Length(message);
  if (length === 0) return 0;
  if (length <= 160) return 1;
  // Concatenated parts each surrender 7 characters to the joining header.
  return Math.ceil(length / 153);
}

/** Where customers are told to follow their order. Kept short: it is billed per character. */
export const ORDER_TRACKING_URL = "healthfieldpharmacy.co.ke/orders";

export type OrderSmsContext = {
  orderNumber: string;
  customerName?: string | null;
  total?: number | null;
  amountDue?: number | null;
  branchName?: string | null;
  pharmacyName?: string;
  /** Shown so a customer with a question can call rather than guess. */
  pharmacyPhone?: string | null;
};

// Counter sales are recorded against a placeholder when nobody gave a name. Greeting
// someone as "Hi Walk-in" reads as careless, so these are treated as no name at all.
const PLACEHOLDER_NAMES = new Set(["walk", "walkin", "walk-in", "customer", "guest", "client", "cash", "n/a", "na", "unknown", "anonymous"]);

function firstName(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (PLACEHOLDER_NAMES.has(trimmed.toLowerCase().replace(/\s+customer$/, ""))) return "";
  const name = trimmed.split(/\s+/)[0] ?? "";
  if (name.length < 2 || PLACEHOLDER_NAMES.has(name.toLowerCase())) return "";
  return name;
}

/** "Hi Grace, " when there is a real name, "Hi customer, " when there is not. */
function greeting(value: string | null | undefined) {
  const name = firstName(value);
  return name ? `Hi ${name}, ` : "Hi customer, ";
}

/** The shop's own number, appended so a reply has somewhere to go. */
function helpline(phone: string | null | undefined) {
  const digits = String(phone ?? "").trim();
  return digits ? ` Help: ${digits}` : "";
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `KES ${Math.round(value).toLocaleString()}` : null;
}

/**
 * The wording of each transactional message.
 *
 * Deliberately short. Every message names the pharmacy, because an SMS from an
 * unregistered sender ID arrives from a bare number and is otherwise unattributable,
 * and every one stays inside a single 160-character segment at typical values.
 */
export function orderSms(purpose: SmsPurpose, context: OrderSmsContext): string {
  const brand = context.pharmacyName?.trim() || "Healthfield";
  const hello = greeting(context.customerName);
  const help = helpline(context.pharmacyPhone);
  const total = money(context.total);
  const due = money(context.amountDue);
  const branch = context.branchName?.trim();

  switch (purpose) {
    case "ORDER_RECEIVED":
      return toGsm7(
        `${hello}${brand} has received your order ${context.orderNumber}. Track it at ${ORDER_TRACKING_URL}.${help}`,
      );
    // The counter sale is already paid and already handed over, so this confirms rather
    // than promises: nothing further is going to happen that the customer must wait for.
    case "POS_SALE_COMPLETE":
      return toGsm7(
        `${hello}we have received your payment and your order has been processed. Thanks for shopping with ${brand}.${help}`,
      );
    case "ORDER_READY_FOR_PICKUP":
      return toGsm7(
        `${hello}order ${context.orderNumber} is ready for pickup${branch ? ` at ${brand} ${branch}` : ` at ${brand}`}. Please carry your order number.${help}`,
      );
    case "ORDER_OUT_FOR_DELIVERY":
      return toGsm7(
        `${hello}order ${context.orderNumber} is ready and on its way to you${due ? `. Please have ${due} ready for the rider` : ""}. ${brand}.${help}`,
      );
    case "PAYMENT_CONFIRMED":
      return toGsm7(
        `${hello}${brand} has confirmed payment${total ? ` of ${total}` : ""} for order ${context.orderNumber}. Thank you.${help}`,
      );
    case "CASH_ON_DELIVERY_DUE":
      return toGsm7(
        `${hello}order ${context.orderNumber} is confirmed for cash on delivery${due ? `. Amount due on arrival: ${due}` : ""}. ${brand}.${help}`,
      );
    default:
      return toGsm7(`${brand}: order ${context.orderNumber} has been updated.`);
  }
}

/**
 * A one-time code message.
 *
 * The code is never preceded by anything a forwarding scam could reuse, and the message
 * says plainly that staff will not ask for it.
 */
export function otpSms(code: string, minutes: number, pharmacyName = "Healthfield") {
  const brand = toGsm7(pharmacyName).trim() || "Healthfield";
  return toGsm7(`${code} is your ${brand} verification code. It expires in ${minutes} minutes. We will never ask you for this code.`);
}

/**
 * A marketing message, always carrying an opt-out.
 *
 * The opt-out is appended here rather than left to whoever writes the campaign, because
 * a promotional SMS without one is a compliance problem, not a style choice.
 */
export function marketingSms(body: string, optOut = "Txt STOP to opt out") {
  const message = toGsm7(body);
  const suffix = toGsm7(optOut);
  if (!message) return "";
  return message.toLowerCase().includes("stop") ? message : `${message} ${suffix}`;
}
