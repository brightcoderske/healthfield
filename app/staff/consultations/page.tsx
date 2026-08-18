import { ConsultationManager, type ConsultationProduct, type ConsultationQueueRecord } from "@/app/admin/consultations/consultation-manager";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";
import { hasStaffPermission } from "@/lib/staff-permissions";

export const dynamic = "force-dynamic";

export default async function StaffConsultationsPage() {
  const session = await requireStaffPermission("CONSULTATIONS_VIEW");
  const data = await backendJson<{ consultations: ConsultationQueueRecord[]; products: ConsultationProduct[] }>("/v1/views/staff/consultations");
  return <main className="data-page">
    <header><a href="/staff">← Staff workspace</a><h1>Consultation queue</h1><p>Review symptoms, reply to the patient and decide the outcome.</p></header>
    <ConsultationManager initialItems={data.consultations} products={data.products} canProcess={hasStaffPermission(session.role, session.permissions, "CONSULTATIONS_PROCESS")} />
  </main>;
}
