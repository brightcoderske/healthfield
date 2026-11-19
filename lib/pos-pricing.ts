/**
 * Prices a till sale's lines, allowing a cashier with the right permission to sell at a price other
 * than the shelf price, and works out what to record about it. Kept pure so the rules can be tested.
 *
 * A changed price never touches the product itself: it applies to this sale only. Every change is
 * listed (product, shelf price, price sold at) so the sale's activity log shows who sold what for
 * how much, and the delivery fee is treated the same way when it differs from the calculated one.
 */
export type PosLineInput = { productId: number; quantity: number; unitPrice?: number };
export type ShelfProduct = { name: string; shelfPrice: number };
export type PosLine = { productId: number; quantity: number; unitPrice: number; shelfPrice: number; base: number };
export type PriceChange = { productId: number; name: string; shelfPrice: number; unitPrice: number };

const cents = (value: number) => Math.round(value * 100) / 100;
const differs = (left: number, right: number) => Math.abs(left - right) > 0.004;

export function buildPosLines(
  items: PosLineInput[],
  shelf: ReadonlyMap<number, ShelfProduct>,
): { ok: true; lines: PosLine[]; priceChanges: PriceChange[] } | { ok: false; error: string } {
  // The same product may be sent more than once (scanned twice). Quantities add up; a price must agree.
  const grouped = new Map<number, { quantity: number; unitPrice: number | undefined }>();
  for (const item of items) {
    const product = shelf.get(item.productId);
    if (!product) return { ok: false, error: "One or more products are unavailable." };
    if (item.unitPrice !== undefined && !(Number.isFinite(item.unitPrice) && item.unitPrice > 0)) {
      return { ok: false, error: `Enter a price above zero for ${product.name}.` };
    }
    const unitPrice = item.unitPrice === undefined ? undefined : cents(item.unitPrice);
    const existing = grouped.get(item.productId);
    if (!existing) {
      grouped.set(item.productId, { quantity: item.quantity, unitPrice });
      continue;
    }
    const before = existing.unitPrice ?? product.shelfPrice;
    const now = unitPrice ?? product.shelfPrice;
    if (differs(before, now)) return { ok: false, error: `${product.name} is in the sale at two different prices. Use one price for it.` };
    existing.quantity += item.quantity;
  }
  const lines: PosLine[] = [];
  const priceChanges: PriceChange[] = [];
  for (const [productId, entry] of grouped) {
    const product = shelf.get(productId)!;
    const unitPrice = entry.unitPrice ?? product.shelfPrice;
    if (differs(unitPrice, product.shelfPrice)) priceChanges.push({ productId, name: product.name, shelfPrice: product.shelfPrice, unitPrice });
    lines.push({ productId, quantity: entry.quantity, unitPrice, shelfPrice: product.shelfPrice, base: cents(unitPrice * entry.quantity) });
  }
  return { ok: true, lines, priceChanges };
}

/**
 * Whether the delivery fee charged is the one the delivery settings calculated. A fee charged with no
 * calculation behind it (no location pinned, or outside the delivery area) counts as set by hand.
 */
export function deliveryFeeWasChanged(fee: number, calculatedFee: number | null) {
  return calculatedFee === null || differs(fee, calculatedFee);
}
