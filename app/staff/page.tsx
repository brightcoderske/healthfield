import { Dashboard } from "@/app/admin/dashboard";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { firstStaffPath, hasStaffPermission } from "@/lib/staff-permissions";

export const dynamic = "force-dynamic";

type Data = {
  newOrders: number;
  pendingPrescriptions: number;
  activeProducts: number;
  lowStock: number;
  customers: number;
  branch: { id: number; name: string };
  recentOrders?: Array<{ id:number; orderNumber:string; customerName:string; status:string; total:string; createdAt:string }>;
  analytics?: Array<{ orderId:number; createdAt:string; status:string; total:string; branch:string|null; productName:string; quantity:number; lineTotal:string; category:string|null }>;
};

export default async function StaffDashboard() {
  const session = await requireRole(["STAFF", "ADMIN", "SUPER_ADMIN"]);
  if (!hasStaffPermission(session.role,session.permissions,"DASHBOARD_VIEW")) redirect(firstStaffPath(session.role,session.permissions));
  const data = await backendJson<Data>("/v1/views/staff/dashboard");
  return <Dashboard name={session.firstName} stats={data} analytics={data.analytics ?? []} recentOrders={data.recentOrders ?? []} variant="staff" branchName={data.branch.name}/>;
}
