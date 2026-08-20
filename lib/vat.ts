/**
 * VAT disclosure for receipts.
 *
 * Kenyan shelf prices include VAT, so a receipt does not add tax to a total — it says
 * how much of that total was tax. Treating the rate as additive would print a figure
 * the customer never paid and would not reconcile against the M-Pesa receipt, so the
 * arithmetic here is deliberately extraction, not addition:
 *
 *   vat = total × rate ÷ (100 + rate)
 *
 * Nothing in checkout, pricing or payment uses this. It exists for what is printed.
 */

/** The largest rate the settings screen accepts; a typo of 160 for 16 is not a rate. */
export const MAX_VAT_RATE = 100;

export function parseVatRate(value: unknown): number {
  const rate = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(MAX_VAT_RATE, rate);
}

/**
 * The VAT contained in a VAT-inclusive total, rounded to cents.
 *
 * Returns null when there is no rate to disclose or nothing to disclose it on, which is
 * what keeps the line off a receipt rather than printing "VAT 0.00".
 */
export function vatIncludedIn(total: unknown, rate: unknown): number | null {
  const percentage = parseVatRate(rate);
  if (!percentage) return null;
  const amount = typeof total === "number" ? total : Number(String(total ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount * percentage) / (100 + percentage) * 100) / 100;
}

/**
 * VAT added on top of a VAT-exclusive net amount, rounded to cents.
 *
 * Healthfield's shelf prices are net of VAT, so tax is added after the goods are
 * totalled rather than extracted from the total. Returns null when there is no rate
 * or nothing to charge it on, which keeps the line off a screen rather than showing
 * "VAT 0.00".
 */
export function vatOnNet(net: unknown, rate: unknown): number | null {
  const percentage = parseVatRate(rate);
  if (!percentage) return null;
  const amount = typeof net === "number" ? net : Number(String(net ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount * percentage) / 100 * 100) / 100;
}

/** "VAT (16%)" — the label carries the rate so an old record stays readable. */
export function vatRateLabel(rate: unknown): string {
  const percentage = parseVatRate(rate);
  if (!percentage) return "VAT";
  const shown = Number.isInteger(percentage) ? String(percentage) : String(Number(percentage.toFixed(2)));
  return `VAT (${shown}%)`;
}

/** "VAT (16% incl.)" — the label carries the rate so an old receipt stays readable. */
export function vatLabel(rate: unknown): string {
  const percentage = parseVatRate(rate);
  if (!percentage) return "VAT";
  const shown = Number.isInteger(percentage) ? String(percentage) : String(Number(percentage.toFixed(2)));
  return `VAT (${shown}% incl.)`;
}
