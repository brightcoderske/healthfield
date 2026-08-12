// Orders that have reached the end of the fulfilment desk's work. They move off the
// active Orders tab and into Past orders so the working list stays short.
export const pastOrderStatuses = ["OUT_FOR_DELIVERY", "COMPLETED"] as const;

export const activeOrderStatuses = [
  "NEW", "AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY",
  "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CANCELLED",
] as const;

export const isPastOrder = (status: string) => (pastOrderStatuses as readonly string[]).includes(status);
