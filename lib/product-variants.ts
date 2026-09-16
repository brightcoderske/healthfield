/**
 * Grouping a product's variants, and deciding which one a screen is showing.
 *
 * A variant is a product row (see the `variant_of` column and migration 0047 for why),
 * so everything that counts stock, cost and sales keeps working per variant. What has to
 * be decided in one place is the *presentation*: a group is one card, one page and one
 * name, and every screen has to agree on which variant leads, what the price reads as,
 * and what the thing is called once it is in a basket.
 *
 * Kept pure so all of that can be tested without a database or a browser.
 */

export type VariantRow = {
  id: number;
  name: string;
  // Decimals arrive as numbers from some endpoints and as strings from others, so both
  // are accepted and coerced at the one place that compares them.
  price: number | string;
  discountPrice: number | string | null;
  imageUrl: string | null;
  /** The label-free product name, carried by every row of a group. */
  groupName?: string | null;
  variantOf?: number | null;
  variantLabel?: string | null;
  variantName?: string | null;
  variantOrder?: number | null;
  isActive?: boolean;
  inStock?: boolean;
};

/** Which group a row belongs to. A lead is its own group; a plain product is a group of one. */
export function groupKey(row: Pick<VariantRow, "id" | "variantOf">) {
  return row.variantOf ?? row.id;
}

export function isLead(row: Pick<VariantRow, "variantOf">) {
  return !row.variantOf;
}

/**
 * What a variant is called once it leaves its group — in a basket, an order, a receipt.
 *
 * This is what gets *stored* as the row's name, not something computed at render time,
 * so a snapshotted order line from two years ago still says which colour was sold.
 */
export function variantDisplayName(groupName: string, label?: string | null) {
  const trimmed = (label || "").trim();
  return trimmed ? `${groupName} — ${trimmed}` : groupName;
}

/** The product's name without any label: what a group's card and page are titled. */
export function productName(row: Pick<VariantRow, "name" | "groupName">) {
  return (row.groupName || "").trim() || row.name;
}

function sellingPrice(row: VariantRow) {
  const value = row.discountPrice === null || row.discountPrice === undefined ? row.price : row.discountPrice;
  const price = Number(value);
  return Number.isFinite(price) ? price : 0;
}

/** Shop order first, then cheapest, then id — so the list never shuffles between renders. */
function byVariantOrder(left: VariantRow, right: VariantRow) {
  const order = (left.variantOrder ?? 0) - (right.variantOrder ?? 0);
  if (order !== 0) return order;
  const price = sellingPrice(left) - sellingPrice(right);
  return price !== 0 ? price : left.id - right.id;
}

export type ProductGroup<T extends VariantRow = VariantRow> = {
  /** The group's own id — the lead variant's product id. */
  id: number;
  /** The product's name, without any variant label. */
  name: string;
  /** What the list of choices is called: "Colour", "Size", "Volume". */
  optionName: string;
  lead: T;
  variants: T[];
  /** The variant a screen shows before anyone chooses: cheapest that is in stock. */
  defaultVariant: T;
  /** True once there is a real choice to make. A group of one is just a product. */
  hasChoice: boolean;
  lowestPrice: number;
  highestPrice: number;
  /** Whether the choice changes what the customer pays, which is what "from KES x" is for. */
  pricesDiffer: boolean;
};

/**
 * The variant a card or page opens on.
 *
 * Cheapest first is the honest default for a price shown before a choice is made, but
 * never one that cannot be bought: opening on a sold-out colour reads as a dead product.
 * `inStock` is optional, and when nothing knows about stock this is simply the cheapest.
 */
export function defaultVariant<T extends VariantRow>(variants: T[]) {
  const ordered = [...variants].sort((left, right) => sellingPrice(left) - sellingPrice(right) || left.id - right.id);
  return ordered.find((variant) => variant.inStock !== false) ?? ordered[0];
}

/**
 * Collapses a flat list of product rows into groups, preserving the order the rows
 * arrived in — the storefront has already decided what leads the page, and grouping must
 * not quietly reorder it. A group takes the position of its first-seen member.
 */
export function groupVariants<T extends VariantRow>(rows: T[]): Array<ProductGroup<T>> {
  const members = new Map<number, T[]>();
  const order: number[] = [];
  for (const row of rows) {
    const key = groupKey(row);
    const existing = members.get(key);
    if (existing) existing.push(row);
    else {
      members.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const variants = (members.get(key) as T[]).sort(byVariantOrder);
    // The lead carries the shared name and the list's own name. When a search returned
    // only a sibling, the lead is absent and the sibling stands in for it.
    const lead = variants.find((variant) => groupKey(variant) === variant.id) ?? variants[0];
    const prices = variants.map(sellingPrice);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    return {
      id: key,
      name: productName(lead),
      optionName: (lead.variantName || "").trim() || "Option",
      lead,
      variants,
      defaultVariant: defaultVariant(variants),
      hasChoice: variants.length > 1,
      lowestPrice,
      highestPrice,
      pricesDiffer: lowestPrice !== highestPrice,
    };
  });
}
