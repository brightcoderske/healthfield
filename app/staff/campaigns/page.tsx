import { CampaignManager, type CampaignInsertables } from "@/app/admin/campaigns/campaign-manager";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

type Campaign = { id: number; name: string; channel: string; status: string; recipientCount: number; successCount: number; failureCount: number; createdAt: string };

export const dynamic = "force-dynamic";

export default async function StaffCampaignsPage() {
  await requireStaffPermission("CAMPAIGNS_MANAGE");
  const { campaigns, insertables } = await backendJson<{ campaigns: Campaign[]; insertables?: CampaignInsertables }>("/v1/views/staff/campaigns");
  return <CampaignManager initialCampaigns={campaigns} insertables={insertables} backHref="/staff" />;
}
