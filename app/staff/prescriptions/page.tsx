import { PrescriptionManager, type PrescriptionProduct, type PrescriptionRecord } from "@/app/admin/prescriptions/prescription-manager";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StaffPrescriptionsPage(){
  await requireRole(["STAFF","ADMIN","SUPER_ADMIN"]);
  const data=await backendJson<{prescriptions:PrescriptionRecord[];products:PrescriptionProduct[]}>("/v1/views/staff/prescriptions");
  return <main className="data-page"><header><a href="/staff">← Staff workspace</a><h1>Prescription queue</h1><p>Review documents, confirm medicines and keep customers informed.</p></header><PrescriptionManager initialItems={data.prescriptions} products={data.products}/></main>;
}
