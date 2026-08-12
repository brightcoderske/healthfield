import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

type Staff = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: "STAFF" | "ADMIN" | "SUPER_ADMIN";
  homeBranchId: number | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
};

type Store = { id: number; name: string };

export default async function StaffPage() {
  const session = await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const { staff, stores } = await backendJson<{ staff: Staff[]; stores: Store[] }>("/v1/views/admin/staff");

  return <StaffManager initialStaff={staff} stores={stores} canManageAdmins={session.role === "SUPER_ADMIN"} />;
}
