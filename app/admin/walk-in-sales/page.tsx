import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { WalkInSaleForm } from "@/app/walk-in-sale-form";
import type { PosWorkspaceData } from "@/app/pos/types";

export const dynamic = "force-dynamic";

export default async function AdminWalkInSalesPage() {
  await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const data = await backendJson<PosWorkspaceData>("/v1/views/walk-in-sale");
  return <WalkInSaleForm {...data} backHref="/admin"/>;
}
