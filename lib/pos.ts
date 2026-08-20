/** Pure POS arithmetic shared by the cashier screen, API and regression tests. */

const cents = (value: number) => Math.round(value * 100) / 100;

export function saleTotal(subtotal: number, discount: number) {
  if (!Number.isFinite(subtotal) || !Number.isFinite(discount)) return 0;
  return cents(Math.max(0, subtotal - Math.max(0, discount)));
}

export function cashChange(amountDue: number, cashReceived: number) {
  if (!Number.isFinite(amountDue) || !Number.isFinite(cashReceived)) return null;
  if (cashReceived + 0.001 < amountDue) return null;
  return cents(cashReceived - amountDue);
}

export function splitPaymentTotal(parts: Array<{ amount: number }>) {
  return cents(parts.reduce((sum, part) => sum + (Number.isFinite(part.amount) ? Math.max(0, part.amount) : 0), 0));
}

export function splitPaymentBalances(total: number, parts: Array<{ amount: number }>) {
  return Math.abs(splitPaymentTotal(parts) - cents(total)) < 0.001;
}

/** Opening cash is what is physically counted; float is displayed separately. */
export function expectedSessionCash(input: { openingCash: number; cashSales: number; cashExpenses: number }) {
  return cents(input.openingCash + input.cashSales - input.cashExpenses);
}

export function sessionCashDifference(actualCash: number, expectedCash: number) {
  return cents(actualCash - expectedCash);
}

export const NAIROBI_TIME_ZONE = "Africa/Nairobi";

export function nairobiDateTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: NAIROBI_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
