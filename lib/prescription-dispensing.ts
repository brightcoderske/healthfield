export const dispenseRules = ["COURSE_BOUND", "DIVISIBLE"] as const;
export type DispenseRule = (typeof dispenseRules)[number];

export const dispenseRuleLabels: Record<DispenseRule, string> = {
  COURSE_BOUND: "Full course only",
  DIVISIBLE: "Part quantity allowed",
};

export const dispenseRuleHints: Record<DispenseRule, string> = {
  COURSE_BOUND:
    "The patient must take the whole quantity or none of it. Use for antibiotics and any medicine where a part course fails or causes resistance.",
  DIVISIBLE:
    "The patient may buy fewer units now and the rest later. Use for repeat and long-term medicines.",
};

export type DispensableLine = {
  id: number;
  approvedQuantity: number;
  dispenseRule: DispenseRule;
  minimumQuantity: number | null;
};

export type LineSelection = { id: number; quantity: number };

// Written without a constructor parameter property: this module is executed directly
// by the test runner, which strips types rather than compiling them.
export class DispensingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// A course-bound line has exactly two lawful choices: all of it, or none of it now.
// A divisible line may be reduced, but never below the floor the pharmacist set.
export function lowestAllowedQuantity(line: DispensableLine) {
  if (line.dispenseRule === "COURSE_BOUND") return line.approvedQuantity;
  return Math.min(Math.max(1, line.minimumQuantity || 1), line.approvedQuantity);
}

export function selectionIsAllowed(line: DispensableLine, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0) return false;
  if (quantity === 0) return true; // Deferring a line is always the patient's choice.
  if (quantity > line.approvedQuantity) return false;
  return quantity >= lowestAllowedQuantity(line);
}

/**
 * Resolves what the patient chose to buy now against what the prescriber authorised.
 *
 * The prescription itself is never edited. This only decides which of its lines are
 * paid for in this transaction; anything deferred stays on the prescription so it can
 * be bought later without another consultation.
 */
export function resolveDispenseSelection(
  lines: readonly DispensableLine[],
  selections: readonly LineSelection[],
) {
  if (!lines.length) throw new DispensingError("This prescription has no priced medicines.");
  const requested = new Map(selections.map((entry) => [entry.id, entry.quantity]));

  const resolved = lines.map((line) => {
    // A line the patient did not mention keeps its full authorised quantity, so a
    // partial payload can never silently reduce a course.
    const quantity = requested.has(line.id) ? Number(requested.get(line.id)) : line.approvedQuantity;
    if (!selectionIsAllowed(line, quantity)) {
      if (line.dispenseRule === "COURSE_BOUND")
        throw new DispensingError("This medicine must be dispensed as a full course. Take all of it now, or choose to buy it later.");
      throw new DispensingError(`Choose between ${lowestAllowedQuantity(line)} and ${line.approvedQuantity} units, or choose to buy this later.`);
    }
    return { id: line.id, quantity, deferred: quantity === 0 };
  });

  if (resolved.every((line) => line.deferred))
    throw new DispensingError("Choose at least one medicine to buy now.");
  return resolved;
}

export function dispenseSelectionSummary(resolved: readonly { deferred: boolean }[]) {
  const deferred = resolved.filter((line) => line.deferred).length;
  return { buyingNow: resolved.length - deferred, deferred, partial: deferred > 0 };
}
