import type { SmsPurpose } from "../../lib/sms-templates";
import { channelEnabled, type CustomerNotificationEventId } from "../../lib/notification-events";
import { sendEmail } from "./email";
import { notificationSettings } from "./notification-settings";
import { sendSms } from "./sms";

type EmailInput = Parameters<typeof sendEmail>[0];

/**
 * Sends one customer message down whichever channels the admin has switched on for
 * `event`.
 *
 * Both channels are offered together so a caller composes the email and the SMS side by
 * side and this decides, from the settings screen's per-event switches, which actually
 * leave. A channel with no recipient or no message is skipped quietly: plenty of
 * customers have a phone but no email, or the reverse.
 *
 * Never throws. A message failing to send must not fail the order, prescription or
 * consultation that caused it; the failure is logged and the work carries on.
 */
export async function notifyCustomer(
  event: CustomerNotificationEventId,
  message: {
    email?: (Omit<EmailInput, "to"> & { to: string | null | undefined }) | null;
    sms?: { to: string | null | undefined; message: string | null; purpose: SmsPurpose; orderId?: number | null } | null;
  },
) {
  try {
    const { customer } = await notificationSettings();
    const sends: Array<Promise<unknown>> = [];
    if (message.email?.to && channelEnabled(customer, event, "email")) {
      sends.push(sendEmail({ ...message.email, to: message.email.to }).catch((error) => console.error("Customer email failed", { event, error })));
    }
    if (message.sms?.to && message.sms.message && channelEnabled(customer, event, "sms")) {
      sends.push(
        sendSms({ to: message.sms.to, message: message.sms.message, purpose: message.sms.purpose, orderId: message.sms.orderId })
          .then((outcome) => { if (outcome.failed) console.warn("Customer SMS was not delivered", { event, detail: outcome.results[0]?.detail }); })
          .catch((error) => console.error("Customer SMS failed", { event, error })),
      );
    }
    await Promise.all(sends);
  } catch (error) {
    console.error("Customer notification failed", { event, error });
  }
}

/** Fire-and-forget form, for the request paths that must answer without waiting on a mail server. */
export function queueCustomerNotification(...args: Parameters<typeof notifyCustomer>) {
  void notifyCustomer(...args);
}
