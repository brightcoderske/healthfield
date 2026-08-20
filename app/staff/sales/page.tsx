import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";
import { WalkInSaleForm } from "@/app/walk-in-sale-form";
import type { PosWorkspaceData } from "@/app/pos/types";

export const dynamic = "force-dynamic";

export default async function StaffSalesPage() {
  await requireStaffPermission("POS_USE");
  const data = await backendJson<PosWorkspaceData>("/v1/views/walk-in-sale");
  return <WalkInSaleForm {...data} backHref="/staff"/>;
}
