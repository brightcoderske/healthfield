/**
 * Every message the pharmacy sends to a customer, one row per moment, each with its own
 * email and SMS switch.
 *
 * The admin settings screen renders this list, the API validates saved preferences
 * against it, and the senders ask it whether a channel is on. Keeping all three on one
 * list is what stops a new message shipping without a switch, or a switch that points at
 * nothing.
 *
 * Security mail — verification links, password resets, login codes — is deliberately not
 * here. A customer who cannot be sent those cannot sign in, so they are never optional.
 *
 * Written without enums or constructor parameter properties: this module is executed
 * directly by the test runner, which strips types rather than compiling them.
 */

export type NotificationChannel = "email" | "sms";

export type ChannelPreference = { email: boolean; sms: boolean };

export type CustomerNotificationEventId =
  | "ACCOUNT_WELCOME"
  | "ORDER_PLACED"
  | "ORDER_PAYMENT_CONFIRMED"
  | "ORDER_AWAITING_PAYMENT"
  | "ORDER_CONFIRMED"
  | "ORDER_UNDER_REVIEW"
  | "ORDER_BEING_FULFILLED"
  | "ORDER_PARTIALLY_READY"
  | "ORDER_READY_FOR_DISPATCH"
  | "ORDER_OUT_FOR_DELIVERY"
  | "ORDER_READY_FOR_PICKUP"
  | "ORDER_COMPLETED"
  | "ORDER_CANCELLED"
  | "POS_SALE"
  | "PRESCRIPTION_RECEIVED"
  | "PRESCRIPTION_APPROVED"
  | "PRESCRIPTION_CLARIFICATION"
  | "PRESCRIPTION_DECLINED"
  | "PRESCRIPTION_RECHECK"
  | "PRESCRIPTION_ISSUED"
  | "CONSULTATION_RECEIVED"
  | "CONSULTATION_REPLY"
  | "CONSULTATION_UPDATE";

export type NotificationGroup = "Account" | "Orders" | "Order progress" | "Prescriptions" | "Consultations";

export type CustomerNotificationEvent = {
  id: CustomerNotificationEventId;
  group: NotificationGroup;
  label: string;
  hint: string;
  defaults: ChannelPreference;
};

const on: ChannelPreference = { email: true, sms: true };
const emailOnly: ChannelPreference = { email: true, sms: false };

export const customerNotificationEvents: CustomerNotificationEvent[] = [
  { id: "ACCOUNT_WELCOME", group: "Account", label: "Welcome", hint: "Sent once, when a new customer verifies their account.", defaults: emailOnly },

  { id: "ORDER_PLACED", group: "Orders", label: "Order received", hint: "Confirms the order reached the pharmacy, the moment it is placed.", defaults: on },
  { id: "ORDER_PAYMENT_CONFIRMED", group: "Orders", label: "Payment confirmed", hint: "When an online payment is matched to the order.", defaults: emailOnly },
  { id: "POS_SALE", group: "Orders", label: "Walk-in sale receipt", hint: "Receipt for a sale rung up at the counter, when the customer left a contact.", defaults: on },

  { id: "ORDER_AWAITING_PAYMENT", group: "Order progress", label: "Awaiting payment", hint: "Staff set the order back to waiting for payment.", defaults: emailOnly },
  { id: "ORDER_CONFIRMED", group: "Order progress", label: "Order confirmed", hint: "Staff accepted the order.", defaults: emailOnly },
  { id: "ORDER_UNDER_REVIEW", group: "Order progress", label: "Under review", hint: "The order is being checked by a pharmacist.", defaults: emailOnly },
  { id: "ORDER_BEING_FULFILLED", group: "Order progress", label: "Being prepared", hint: "The order is being picked and packed.", defaults: emailOnly },
  { id: "ORDER_PARTIALLY_READY", group: "Order progress", label: "Partly ready", hint: "Some of the items are packed, the rest are still on the way.", defaults: emailOnly },
  { id: "ORDER_READY_FOR_DISPATCH", group: "Order progress", label: "Packed, ready for dispatch", hint: "Packed and waiting for a rider.", defaults: emailOnly },
  { id: "ORDER_OUT_FOR_DELIVERY", group: "Order progress", label: "Out for delivery", hint: "With the rider, on the way to the customer.", defaults: on },
  { id: "ORDER_READY_FOR_PICKUP", group: "Order progress", label: "Ready for pickup", hint: "Packed and waiting at the shop.", defaults: on },
  { id: "ORDER_COMPLETED", group: "Order progress", label: "Order completed", hint: "Delivered or collected. The email carries the receipt.", defaults: emailOnly },
  { id: "ORDER_CANCELLED", group: "Order progress", label: "Order cancelled", hint: "The order was cancelled by the pharmacy.", defaults: on },

  { id: "PRESCRIPTION_RECEIVED", group: "Prescriptions", label: "Prescription received", hint: "Confirms the upload reached the pharmacist.", defaults: on },
  { id: "PRESCRIPTION_APPROVED", group: "Prescriptions", label: "Prescription approved", hint: "The pharmacist priced it and it is ready to pay.", defaults: on },
  { id: "PRESCRIPTION_CLARIFICATION", group: "Prescriptions", label: "More information needed", hint: "The pharmacist has a question before going ahead.", defaults: on },
  { id: "PRESCRIPTION_DECLINED", group: "Prescriptions", label: "Prescription declined", hint: "The request could not be approved.", defaults: on },
  { id: "PRESCRIPTION_RECHECK", group: "Prescriptions", label: "Availability re-checked", hint: "Stock changed after approval, so the proposal is being re-checked.", defaults: emailOnly },
  { id: "PRESCRIPTION_ISSUED", group: "Prescriptions", label: "Prescription issued after a consultation", hint: "A consultation ended with a prescription for the pharmacist to price.", defaults: emailOnly },

  { id: "CONSULTATION_RECEIVED", group: "Consultations", label: "Consultation received", hint: "Confirms the request reached the pharmacy.", defaults: on },
  { id: "CONSULTATION_REPLY", group: "Consultations", label: "Professional replied", hint: "A new message from the healthcare professional.", defaults: on },
  { id: "CONSULTATION_UPDATE", group: "Consultations", label: "Consultation updated or closed", hint: "A status update or closing note.", defaults: emailOnly },
];

const eventIds = new Set<string>(customerNotificationEvents.map((event) => event.id));

/** What the customer has been told they will get, as saved: only the choices that differ matter. */
export type CustomerNotificationPreferences = Partial<Record<CustomerNotificationEventId, Partial<ChannelPreference>>>;

export function isCustomerNotificationEvent(value: unknown): value is CustomerNotificationEventId {
  return typeof value === "string" && eventIds.has(value);
}

/**
 * Cleans whatever was stored or submitted down to known events and real booleans.
 *
 * Unknown events are dropped rather than rejected so a column written by a newer
 * release never stops an older one from reading its settings.
 */
export function parseNotificationPreferences(value: unknown): CustomerNotificationPreferences {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const clean: CustomerNotificationPreferences = {};
  for (const [id, entry] of Object.entries(source as Record<string, unknown>)) {
    if (!isCustomerNotificationEvent(id) || !entry || typeof entry !== "object") continue;
    const channels: Partial<ChannelPreference> = {};
    for (const channel of ["email", "sms"] as const) {
      const flag = (entry as Record<string, unknown>)[channel];
      if (typeof flag === "boolean") channels[channel] = flag;
    }
    if (Object.keys(channels).length) clean[id] = channels;
  }
  return clean;
}

/** Whether `channel` is on for `event`: the saved choice, else the event's default. */
export function channelEnabled(
  preferences: CustomerNotificationPreferences | null | undefined,
  event: CustomerNotificationEventId,
  channel: NotificationChannel,
) {
  const saved = preferences?.[event]?.[channel];
  if (typeof saved === "boolean") return saved;
  return customerNotificationEvents.find((entry) => entry.id === event)!.defaults[channel];
}

/** Every event with its channels resolved, in display order. */
export function resolveNotificationPreferences(preferences: CustomerNotificationPreferences | null | undefined) {
  return customerNotificationEvents.map((event) => ({
    ...event,
    email: channelEnabled(preferences, event.id, "email"),
    sms: channelEnabled(preferences, event.id, "sms"),
  }));
}

const STATUS_EVENTS: Record<string, CustomerNotificationEventId> = {
  AWAITING_PAYMENT: "ORDER_AWAITING_PAYMENT",
  CONFIRMED: "ORDER_CONFIRMED",
  UNDER_REVIEW: "ORDER_UNDER_REVIEW",
  BEING_FULFILLED: "ORDER_BEING_FULFILLED",
  PARTIALLY_READY: "ORDER_PARTIALLY_READY",
  READY_FOR_DISPATCH: "ORDER_READY_FOR_DISPATCH",
  OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY",
  READY_FOR_PICKUP: "ORDER_READY_FOR_PICKUP",
  COMPLETED: "ORDER_COMPLETED",
  CANCELLED: "ORDER_CANCELLED",
};

/** The switch that governs a move to `status`, or null for a status customers are never told about. */
export function orderStatusEvent(status: string): CustomerNotificationEventId | null {
  return STATUS_EVENTS[status] ?? null;
}
