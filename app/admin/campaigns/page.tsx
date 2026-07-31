import { backendJson } from "@/lib/backend-api";
import { CampaignManager } from "./campaign-manager";
export const dynamic="force-dynamic";
export default async function CampaignsPage(){const {campaigns}=await backendJson<{campaigns:Array<{id:number;name:string;channel:string;status:string;recipientCount:number;successCount:number;failureCount:number;createdAt:string}>}>("/v1/views/admin/campaigns");return <CampaignManager initialCampaigns={campaigns}/>}
