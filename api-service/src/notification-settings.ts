import { siteSettings } from "../../db/schema";
import { getDb } from "./db";

export type NotificationSettings = {
  notifyNewOrder: boolean;
  notifyOrderStatusChange: boolean;
  notifyCustomerReceivedOrder: boolean;
  notifyNewPrescription: boolean;
  notifyNewConsultation: boolean;
  notifyNewCustomer: boolean;
  notifyTillPayment: boolean;
  smsPrescriptionUpdatesEnabled: boolean;
  smsConsultationUpdatesEnabled: boolean;
};

// Mirrors the site_settings column defaults, so a fresh install without a settings
// row yet behaves exactly as it would once one is saved.
const defaults: NotificationSettings = {
  notifyNewOrder: true,
  notifyOrderStatusChange: true,
  notifyCustomerReceivedOrder: true,
  notifyNewPrescription: true,
  notifyNewConsultation: true,
  notifyNewCustomer: true,
  notifyTillPayment: false,
  smsPrescriptionUpdatesEnabled: false,
  smsConsultationUpdatesEnabled: false,
};

/** The name and helpline shown inside customer-facing SMS, wherever one is composed. */
export async function pharmacyIdentity() {
  const db = getDb();
  const [row] = await db.select({ pharmacyName: siteSettings.pharmacyName, phone: siteSettings.phone }).from(siteSettings).limit(1);
  return { pharmacyName: row?.pharmacyName, pharmacyPhone: row?.phone ?? null };
}

export async function notificationSettings(): Promise<NotificationSettings> {
  const db = getDb();
  const [row] = await db.select({
    notifyNewOrder: siteSettings.notifyNewOrder,
    notifyOrderStatusChange: siteSettings.notifyOrderStatusChange,
    notifyCustomerReceivedOrder: siteSettings.notifyCustomerReceivedOrder,
    notifyNewPrescription: siteSettings.notifyNewPrescription,
    notifyNewConsultation: siteSettings.notifyNewConsultation,
    notifyNewCustomer: siteSettings.notifyNewCustomer,
    notifyTillPayment: siteSettings.notifyTillPayment,
    smsPrescriptionUpdatesEnabled: siteSettings.smsPrescriptionUpdatesEnabled,
    smsConsultationUpdatesEnabled: siteSettings.smsConsultationUpdatesEnabled,
  }).from(siteSettings).limit(1);
  return row ?? defaults;
}
