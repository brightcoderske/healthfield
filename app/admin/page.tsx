import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

type Data = {
  newOrders: number;
  pendingPrescriptions: number;
  activeProducts: number;
  lowStock: number;
  customers: number;
  recentOrders?: Array<{ id:number; orderNumber:string; customerName:string; status:string; total:string; createdAt:string }>;
  analytics?: Array<{ orderId:number; createdAt:string; status:string; total:string; branch:string|null; productName:string; quantity:number; lineTotal:string; category:string|null }>;
};

export default async function AdminPage() {
  const session = await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const data = await backendJson<Data>("/v1/views/admin/dashboard");
  return <Dashboard name={session.firstName} stats={data} analytics={data.analytics ?? []} recentOrders={data.recentOrders ?? []}/>;
}
