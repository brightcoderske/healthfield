import { requireRole } from "@/lib/auth";
import { backendJson } from "@/lib/backend-api";
import { AdminBackToTop } from "@/app/admin/admin-back-to-top";
import { StaffNavigation } from "./staff-navigation";
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole(["STAFF", "ADMIN", "SUPER_ADMIN"]);
  const data=await backendJson<{newOrders:number;pendingPrescriptions:number;branch:{id:number;name:string}}>("/v1/views/staff/navigation");
  return <div className="admin-shell"><StaffNavigation firstName={session.firstName} branchName={data.branch.name} counts={data}/><div className="admin-layout-content">{children}</div><AdminBackToTop/></div>;
}
