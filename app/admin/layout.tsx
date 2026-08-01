import { requireRole } from "@/lib/auth";
import { AdminNavigation } from "./admin-navigation";
import { backendJson } from "@/lib/backend-api";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const counts=await backendJson<{newOrders:number;newChats:number}>("/v1/views/admin/dashboard");
  return <div className="admin-shell"><AdminNavigation firstName={session.firstName} role={session.role} counts={counts}/><div className="admin-layout-content">{children}</div></div>;
}
