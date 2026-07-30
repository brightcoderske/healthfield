import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { campaigns } from "@/db/schema";
import { CampaignManager } from "./campaign-manager";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const rows = await getDb().select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(30);
  return <CampaignManager initialCampaigns={rows} />;
}
