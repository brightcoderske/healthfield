/**
 * Buying price, selling price, and the profit between them.
 *
 * One rule decides the shop's pricing: a product sells for 133% of what it cost, which
 * is a 33% markup and a 24.8% margin on the selling price. The number lives here alone
 * so changing the house rule is one edit rather than a hunt through forms and reports.
 *
 * Everything is money, so everything rounds to cents at the point it is produced rather
 * than being left to accumulate float noise across a month of order lines.
 */

/** Selling price as a multiple of the buying price. 1.33 is a 33% markup. */
export const DEFAULT_MARKUP = 1.33;

const cents = (value: number) => Math.round(value * 100) / 100;

function money(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(amount) ? amount : null;
}

/** What a product should sell for, given what it cost. */
export function sellingPriceFromCost(cost: unknown, markup = DEFAULT_MARKUP): number | null {
  const amount = money(cost);
  if (amount === null || amount <= 0) return null;
  return cents(amount * markup);
}

/**
 * What a product probably cost, given what it sells for.
 *
 * Used once, to seed products that existed before buying prices did. It is an estimate
 * by construction — the shelf price is the only evidence available — which is why rows
 * seeded this way stay flagged until someone confirms them.
 */
export function costFromSellingPrice(price: unknown, markup = DEFAULT_MARKUP): number | null {
  const amount = money(price);
  if (amount === null || amount <= 0) return null;
  return cents(amount / markup);
}

/** Margin on the selling price, as a percentage: 133 from 100 is 24.8%, not 33%. */
export function marginPercent(cost: unknown, price: unknown): number | null {
  const buying = money(cost);
  const selling = money(price);
  if (buying === null || selling === null || selling <= 0) return null;
  return cents(((selling - buying) / selling) * 100);
}

export type ProfitLine = {
  /** What the customer paid for the line, after any discount. */
  lineTotal: unknown;
  quantity: unknown;
  /** Cost captured when the line sold. */
  unitCost?: unknown;
  /** The product's cost today, used only when the line carries none. */
  productCost?: unknown;
};

export type ProfitSummary = {
  sales: number;
  cost: number;
  profit: number;
  /** Lines whose cost had to be guessed, and their share of the sales value. */
  estimatedLines: number;
  estimatedSales: number;
  /** Lines with no cost available at all, and the sales value they carry. */
  unpricedLines: number;
  unpricedSales: number;
};

/**
 * Adds up sales and profit over order lines.
 *
 * A line with no cost anywhere is held out of the profit arithmetic entirely — its
 * revenue still counts as sales, but it is subtracted before profit is taken. Leaving
 * it in with a zero cost would report the whole sale as profit, which is the one wrong
 * answer that looks like good news. The excluded value is returned so a report can say
 * how much of the day it could not price.
 */
export function summariseProfit(lines: ProfitLine[]): ProfitSummary {
  const summary: ProfitSummary = { sales: 0, cost: 0, profit: 0, estimatedLines: 0, estimatedSales: 0, unpricedLines: 0, unpricedSales: 0 };
  for (const line of lines) {
    const revenue = money(line.lineTotal) ?? 0;
    const quantity = Math.max(0, Math.trunc(money(line.quantity) ?? 0));
    summary.sales += revenue;
    const snapshot = money(line.unitCost);
    const fallback = money(line.productCost);
    const unit = snapshot !== null && snapshot > 0 ? snapshot : fallback !== null && fallback > 0 ? fallback : null;
    if (unit === null) {
      summary.unpricedLines += 1;
      summary.unpricedSales += revenue;
      continue;
    }
    if (snapshot === null || snapshot <= 0) {
      summary.estimatedLines += 1;
      summary.estimatedSales += revenue;
    }
    summary.cost += unit * quantity;
  }
  summary.sales = cents(summary.sales);
  summary.cost = cents(summary.cost);
  summary.estimatedSales = cents(summary.estimatedSales);
  summary.unpricedSales = cents(summary.unpricedSales);
  summary.profit = cents(summary.sales - summary.unpricedSales - summary.cost);
  return summary;
}
