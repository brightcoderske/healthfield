import { getDb } from "@/db";
import { siteSettings } from "@/db/schema";
import { SettingsForm } from "./settings-form";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const [settings] = await getDb().select().from(siteSettings).limit(1);
  return <SettingsForm initial={settings ?? null} />;
}
