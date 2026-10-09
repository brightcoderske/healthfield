import type { DeliveryOutcome, OutboxJob } from "./outbox";
import { sendEmail } from "./email";
import { getOutbox } from "./redis";
import { sendSms } from "./sms";

/**
 * Sends the outbox's messages, and is where the rest of the API hands messages over.
 *
 * `sendEmailQueued` and `sendSmsQueued` are for the many places that send a message and do
 * not need to know how it went — order updates, prescription and consultation replies,
 * alerts to the pharmacy. The message is written to the outbox and retried until it goes;
 * if the outbox is not available it is sent directly, the way it always was.
 *
 * They are deliberately NOT used where the caller needs the result: login codes, account
 * verification, password resets and campaign sends all look at whether the send worked and
 * tell the person, so those keep calling sendEmail and sendSms themselves. Emails that carry
 * an attachment (the PDF receipts) are not queued either.
 */

type EmailMessage = Parameters<typeof sendEmail>[0];
type SmsMessage = Parameters<typeof sendSms>[0];

async function deliverEmail(job: OutboxJob): Promise<DeliveryOutcome> {
  const result = await sendEmail(job.payload as EmailMessage);
  if (result.sent) return { result: "delivered" };
  // No mail server is set up: trying again in a minute will not change that.
  if (result.reason === "not-configured") return { result: "skipped", reason: "email is not configured" };
  return { result: "retry", reason: result.reason };
}

async function deliverSms(job: OutboxJob): Promise<DeliveryOutcome> {
  const outcome = await sendSms(job.payload as SmsMessage);
  // Not configured, switched off, or no valid number: nothing a retry could fix.
  if (outcome.skipped) return { result: "skipped", reason: outcome.skipped };
  if (outcome.sent > 0) return { result: "delivered" };
  if (outcome.failed > 0) return { result: "retry", reason: outcome.results[0]?.detail || "the SMS gateway did not accept the message" };
  return { result: "skipped", reason: "nothing to send" };
}

/** Registers the senders and starts the worker. Does nothing if Redis is not configured. */
export function startOutbox() {
  const outbox = getOutbox({ email: deliverEmail, sms: deliverSms });
  outbox.start();
  return outbox;
}

export async function sendEmailQueued(message: EmailMessage): Promise<void> {
  try {
    const outbox = getOutbox({ email: deliverEmail, sms: deliverSms });
    if (!message.attachments?.length && (await outbox.enqueue("email", message))) {
      outbox.kick();
      return;
    }
    await sendEmail(message);
  } catch (error) {
    console.error("Email could not be sent or queued", error);
  }
}

export async function sendSmsQueued(message: SmsMessage): Promise<void> {
  try {
    const outbox = getOutbox({ email: deliverEmail, sms: deliverSms });
    if (await outbox.enqueue("sms", message)) {
      outbox.kick();
      return;
    }
    await sendSms(message);
  } catch (error) {
    console.error("SMS could not be sent or queued", error);
  }
}

/** For /health: how much is waiting, and how much has been given up on. */
export async function outboxStatus() {
  const outbox = getOutbox();
  if (!outbox.storage) return { enabled: false };
  try {
    return { enabled: true, ...(await outbox.storage.counts()) };
  } catch {
    return { enabled: true, unavailable: true };
  }
}
