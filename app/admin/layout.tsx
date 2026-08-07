import { requireRole } from "@/lib/auth";
import { AdminNavigation } from "./admin-navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { AdminBackToTop } from "./admin-back-to-top";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const counts=await backendJson<{newOrders:number;newChats:number}>("/v1/views/admin/navigation").catch((error)=>{
    if(error instanceof BackendError&&error.status===404)return backendJson<{newOrders:number;newChats:number}>("/v1/views/admin/dashboard");
    throw error;
  });
  return <div className="admin-shell"><AdminNavigation firstName={session.firstName} role={session.role} counts={counts}/><div className="admin-layout-content">{children}</div><AdminBackToTop/></div>;
}
