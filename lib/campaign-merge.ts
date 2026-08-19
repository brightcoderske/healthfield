/**
 * Campaign templating: personalisation tokens and inserted content.
 *
 * Two kinds of token, both written in braces so one parser handles them:
 *
 *   {name}          a merge field, replaced per recipient
 *   {product:12}    a content block, replaced with a rendered card or a link
 *
 * Everything here is pure. Resolving a product into a card needs the database, so the
 * caller supplies a renderer; this module only finds the references and substitutes
 * what it is given. That keeps the exact output assertable in tests.
 *
 * Written without constructor parameter properties or enums: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export type CampaignChannel = "EMAIL" | "SMS";

export type MergeRecipient = {
  firstName?: string | null;
  lastName?: string | null;
  /** Used when the contact came from an order rather than an account. */
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type MergeContext = {
  pharmacyName?: string | null;
  pharmacyPhone?: string | null;
  storefrontUrl?: string | null;
};

/** Offered in the composer as click-to-insert buttons. */
export const MERGE_FIELDS: ReadonlyArray<{ token: string; label: string; help: string }> = [
  { token: "{name}", label: "Customer name", help: "Their first name, or \"customer\" when we do not know it." },
  { token: "{fullname}", label: "Full name", help: "First and last name where both are known." },
  { token: "{pharmacy}", label: "Pharmacy name", help: "Your shop name from Settings." },
  { token: "{phone}", label: "Shop phone", help: "Your contact number from Settings." },
  { token: "{website}", label: "Website", help: "A link back to the storefront." },
];

// The same placeholder rules the transactional messages use, so a walk-in contact is
// never greeted by the label the till gave them.
const PLACEHOLDER_NAMES = new Set([
  "walk", "walkin", "walk-in", "customer", "guest", "client", "cash", "n/a", "na", "unknown", "anonymous",
]);

/** A usable first name, or "" when there is nothing worth addressing them by. */
export function recipientFirstName(recipient: MergeRecipient): string {
  const candidate = String(recipient.firstName ?? recipient.fullName ?? "").trim();
  if (!candidate) return "";
  if (PLACEHOLDER_NAMES.has(candidate.toLowerCase().replace(/\s+customer$/, ""))) return "";
  const first = candidate.split(/\s+/)[0] ?? "";
  if (first.length < 2 || PLACEHOLDER_NAMES.has(first.toLowerCase())) return "";
  return first;
}

export function recipientFullName(recipient: MergeRecipient): string {
  const first = recipientFirstName(recipient);
  if (!first) return "";
  const last = String(recipient.lastName ?? "").trim();
  if (last && !PLACEHOLDER_NAMES.has(last.toLowerCase())) return `${first} ${last}`;
  // fullName may already carry both parts when the contact came from an order.
  const whole = String(recipient.fullName ?? "").trim();
  return whole.split(/\s+/).length > 1 ? whole : first;
}

export type ContentKind = "product" | "offer" | "blog";
export type ContentReference = { kind: ContentKind; id: number; token: string };

const CONTENT_PATTERN = /\{\s*(product|offer|blog)\s*:\s*(\d+)\s*\}/gi;

/** Every content block a template asks for, so the caller can fetch them in one query. */
export function extractContentReferences(template: string): ContentReference[] {
  const found = new Map<string, ContentReference>();
  for (const match of String(template ?? "").matchAll(CONTENT_PATTERN)) {
    const kind = match[1].toLowerCase() as ContentKind;
    const id = Number(match[2]);
    const key = `${kind}:${id}`;
    if (!found.has(key)) found.set(key, { kind, id, token: match[0] });
  }
  return [...found.values()];
}

/** Whether a template differs per recipient, which decides how it can be sent. */
export function isPersonalised(template: string) {
  return /\{\s*(name|fullname)\s*\}/i.test(String(template ?? ""));
}

/**
 * Substitutes the merge fields for one recipient.
 *
 * An unknown name becomes "customer" rather than an empty gap, so a sentence never
 * collapses into "Hi , we have an offer".
 */
export function renderMergeFields(template: string, recipient: MergeRecipient, context: MergeContext = {}) {
  const first = recipientFirstName(recipient);
  const whole = recipientFullName(recipient);
  const replacements: Record<string, string> = {
    name: first || "customer",
    fullname: whole || first || "customer",
    pharmacy: String(context.pharmacyName ?? "").trim() || "Healthfield Pharmacy",
    phone: String(context.pharmacyPhone ?? "").trim(),
    website: String(context.storefrontUrl ?? "").trim(),
  };
  return String(template ?? "").replace(/\{\s*(name|fullname|pharmacy|phone|website)\s*\}/gi, (_whole, key: string) => {
    return replacements[key.toLowerCase()] ?? "";
  });
}

export type RenderedContent = {
  /** Rich markup for email. */
  html: string;
  /** Plain equivalent for SMS and the text part of an email. */
  text: string;
};

/**
 * Replaces every content token using the supplied renderer.
 *
 * A token whose item has since been deleted or unpublished resolves to nothing rather
 * than being left visible: a customer should never receive "{product:12}".
 */
export function renderContentBlocks(
  template: string,
  channel: CampaignChannel,
  resolve: (reference: ContentReference) => RenderedContent | null,
) {
  return String(template ?? "").replace(CONTENT_PATTERN, (token, kind: string, id: string) => {
    const rendered = resolve({ kind: kind.toLowerCase() as ContentKind, id: Number(id), token });
    if (!rendered) return "";
    return channel === "EMAIL" ? rendered.html : rendered.text;
  });
}

/**
 * The longest a personalised message can get, used to price an SMS campaign honestly.
 *
 * Segments are billed per recipient, and a long name can tip a message over the 160
 * character edge, so the estimate uses the longest name in the audience rather than a
 * comfortable example.
 */
export function longestRenderedLength(
  template: string,
  recipients: MergeRecipient[],
  context: MergeContext = {},
  measure: (message: string) => number = (message) => message.length,
) {
  if (!recipients.length) return measure(renderMergeFields(template, {}, context));
  let longest = 0;
  for (const recipient of recipients) {
    longest = Math.max(longest, measure(renderMergeFields(template, recipient, context)));
  }
  return longest;
}
