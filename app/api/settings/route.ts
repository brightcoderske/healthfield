import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { siteSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";

const settingsSchema = z.object({
  pharmacyName: z.string().trim().min(2).max(150),
  phone: z.string().trim().max(30),
  whatsapp: z.string().trim().max(30),
  supportEmail: z.string().trim().email().or(z.literal("")),
  address: z.string().trim().max(1000),
  openingHours: z.string().trim().max(255),
  deliveryMessage: z.string().trim().min(2).max(255),
  freeDeliveryThreshold: z.coerce.number().nonnegative().optional(),
  bulkSmsApiUrl: z.string().trim().url().or(z.literal("")),
  bulkSmsApiKey: z.string().trim().max(500),
  bulkSmsSenderId: z.string().trim().max(50),
  emailApiUrl: z.string().trim().url().or(z.literal("")),
  emailApiKey: z.string().trim().max(500),
  campaignFromEmail: z.string().trim().email().or(z.literal("")),
});

export async function GET() {
  const [settings] = await getDb().select({
    pharmacyName: siteSettings.pharmacyName,
    phone: siteSettings.phone,
    whatsapp: siteSettings.whatsapp,
    supportEmail: siteSettings.supportEmail,
    address: siteSettings.address,
    openingHours: siteSettings.openingHours,
    deliveryMessage: siteSettings.deliveryMessage,
    freeDeliveryThreshold: siteSettings.freeDeliveryThreshold,
  }).from(siteSettings).limit(1);
  return NextResponse.json({ settings: settings ?? null });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session || !["ADMIN", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  const values = {
    ...parsed.data,
    phone: parsed.data.phone || null,
    whatsapp: parsed.data.whatsapp || null,
    supportEmail: parsed.data.supportEmail || null,
    address: parsed.data.address || null,
    openingHours: parsed.data.openingHours || null,
    freeDeliveryThreshold: parsed.data.freeDeliveryThreshold?.toString() ?? null,
    bulkSmsApiUrl: parsed.data.bulkSmsApiUrl || null,
    bulkSmsApiKey: parsed.data.bulkSmsApiKey || null,
    bulkSmsSenderId: parsed.data.bulkSmsSenderId || null,
    emailApiUrl: parsed.data.emailApiUrl || null,
    emailApiKey: parsed.data.emailApiKey || null,
    campaignFromEmail: parsed.data.campaignFromEmail || null,
    updatedBy: session.userId,
  };
  const db = getDb();
  const [current] = await db.select({ id: siteSettings.id }).from(siteSettings).limit(1);
  if (current) await db.update(siteSettings).set(values).where(eq(siteSettings.id, current.id));
  else await db.insert(siteSettings).values(values);
  return NextResponse.json({ ok: true });
}
