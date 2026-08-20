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
  analytics?: Array<{ orderId:number; createdAt:string; status:string; total:string; branch:string|null; productName:string; quantity:number; lineTotal:string; unitCost?:string|null; productCost?:string|null; category:string|null }>;
  deliveryBands?: Array<{ id:number; label:string; minKm:string }>;
  deliveries?: Array<{ orderId:number; createdAt:string; deliveryFee:string; distanceKm:string|null; bandId:number|null; bandLabel:string|null; bandMinKm:string|null }>;
  vat?: { enabled:boolean; rate:number };
};

export default async function AdminPage() {
  const session = await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const data = await backendJson<Data>("/v1/views/admin/dashboard");
  return <Dashboard role={session.role} name={session.firstName} stats={data} analytics={data.analytics ?? []} deliveries={data.deliveries ?? []} deliveryBands={data.deliveryBands ?? []} recentOrders={data.recentOrders ?? []} vat={data.vat}/>;
}
