import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { campaigns, siteSettings, users } from "@/db/schema";
import { getSession } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(180),
  channel: z.enum(["EMAIL", "SMS", "EMAIL_AND_SMS"]),
  subject: z.string().trim().max(220).optional().default(""),
  message: z.string().trim().min(2).max(3000),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid campaign." }, { status: 400 });
  const db = getDb();
  const [settings] = await db.select().from(siteSettings).limit(1);
  const customers = await db.select({ email: users.email, phone: users.phone }).from(users).where(and(eq(users.role, "CUSTOMER"), eq(users.isActive, true),eq(users.marketingConsent,true)));
  const wantsEmail = parsed.data.channel !== "SMS";
  const wantsSms = parsed.data.channel !== "EMAIL";
  if (wantsEmail && (!settings?.emailApiUrl || !settings.emailApiKey || !settings.campaignFromEmail)) return NextResponse.json({ error: "Configure the email campaign API in Settings first." }, { status: 400 });
  if (wantsSms && (!settings?.bulkSmsApiUrl || !settings.bulkSmsApiKey || !settings.bulkSmsSenderId)) return NextResponse.json({ error: "Configure the bulk SMS API in Settings first." }, { status: 400 });
  const [created] = await db.insert(campaigns).values({ ...parsed.data, subject: parsed.data.subject || null, status: "SENDING", recipientCount: customers.length, createdBy: session.userId });
  let successCount = 0;
  let failureCount = 0;
  try {
    if (wantsEmail) {
      const recipients = customers.map((customer) => customer.email).filter(Boolean);
      const response = await fetch(settings!.emailApiUrl!, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings!.emailApiKey}` }, body: JSON.stringify({ recipients, from: settings!.campaignFromEmail, subject: parsed.data.subject, message: parsed.data.message }) });
      response.ok ? successCount += recipients.length : failureCount += recipients.length;
    }
    if (wantsSms) {
      const recipients = customers.map((customer) => customer.phone).filter((phone): phone is string => Boolean(phone));
      const response = await fetch(settings!.bulkSmsApiUrl!, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings!.bulkSmsApiKey}` }, body: JSON.stringify({ recipients, senderId: settings!.bulkSmsSenderId, message: parsed.data.message }) });
      response.ok ? successCount += recipients.length : failureCount += recipients.length;
    }
    await db.update(campaigns).set({ status: failureCount ? "FAILED" : "SENT", successCount, failureCount, sentAt: new Date() }).where(eq(campaigns.id, created.insertId));
  } catch {
    failureCount = customers.length;
    await db.update(campaigns).set({ status: "FAILED", successCount, failureCount }).where(eq(campaigns.id, created.insertId));
  }
  return NextResponse.json({ ok: failureCount === 0, id: created.insertId, recipientCount: customers.length, successCount, failureCount }, { status: failureCount ? 502 : 201 });
}
