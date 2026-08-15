export const orderStatuses = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type OrderFulfilmentMethod = "DELIVERY" | "PICKUP";

const deliveryStatuses = orderStatuses.filter((status) => status !== "READY_FOR_PICKUP");
const pickupStatuses = orderStatuses.filter((status) => status !== "READY_FOR_DISPATCH" && status !== "OUT_FOR_DELIVERY");

const lockedTransitions: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  READY_FOR_DISPATCH: ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "COMPLETED"],
  OUT_FOR_DELIVERY: ["OUT_FOR_DELIVERY", "COMPLETED"],
  READY_FOR_PICKUP: ["READY_FOR_PICKUP", "COMPLETED"],
  COMPLETED: ["COMPLETED"],
  CANCELLED: ["CANCELLED"],
};

export function applicableOrderStatuses(fulfilmentMethod: OrderFulfilmentMethod): readonly OrderStatus[] {
  return fulfilmentMethod === "DELIVERY" ? deliveryStatuses : pickupStatuses;
}

export function allowedOrderStatuses(current: OrderStatus, fulfilmentMethod?: OrderFulfilmentMethod): readonly OrderStatus[] {
  const transitionStatuses: readonly OrderStatus[] = lockedTransitions[current] ?? orderStatuses;
  if (!fulfilmentMethod) return transitionStatuses;
  const applicable = applicableOrderStatuses(fulfilmentMethod);
  return transitionStatuses.filter((status) => status === current || applicable.includes(status));
}

export function canTransitionOrderStatus(current: OrderStatus, next: OrderStatus, fulfilmentMethod?: OrderFulfilmentMethod) {
  return allowedOrderStatuses(current, fulfilmentMethod).includes(next);
}

export function orderDetailsAreEditable(status: OrderStatus) {
  return !["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].includes(status);
}

export function isStockFinalizedOrderStatus(status: OrderStatus) {
  return ["READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED"].includes(status);
}

export function orderTransitionChangesAllocation(current: OrderStatus, next: OrderStatus, fulfilmentsProvided: boolean) {
  return fulfilmentsProvided || next === "CANCELLED" || (isStockFinalizedOrderStatus(next) && !isStockFinalizedOrderStatus(current));
}
