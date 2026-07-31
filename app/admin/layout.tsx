import { requireRole } from "@/lib/auth";
import { AdminNavigation } from "./admin-navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session=await requireRole(["ADMIN", "SUPER_ADMIN"]);
  return <div className="admin-shell"><AdminNavigation firstName={session.firstName} role={session.role}/><div className="admin-layout-content">{children}</div></div>;
}
