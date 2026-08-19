import { backendJson } from "@/lib/backend-api";
import { CampaignManager, type CampaignInsertables } from "./campaign-manager";
export const dynamic="force-dynamic";
export default async function CampaignsPage(){const {campaigns,insertables}=await backendJson<{campaigns:Array<{id:number;name:string;channel:string;status:string;recipientCount:number;successCount:number;failureCount:number;createdAt:string}>;insertables?:CampaignInsertables}>("/v1/views/admin/campaigns");return <CampaignManager initialCampaigns={campaigns} insertables={insertables}/>}
