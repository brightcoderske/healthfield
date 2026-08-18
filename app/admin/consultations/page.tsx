import { backendJson } from "@/lib/backend-api";
import { ConsultationManager, type ConsultationProduct, type ConsultationQueueRecord } from "./consultation-manager";

export const dynamic = "force-dynamic";

export default async function AdminConsultationsPage() {
  const data = await backendJson<{ consultations: ConsultationQueueRecord[]; products: ConsultationProduct[] }>("/v1/views/admin/consultations");
  return <main className="data-page">
    <header><a href="/admin">← Dashboard</a><h1>Consultations</h1><p>Review symptoms, reply to the patient and decide on a prescription, over-the-counter advice or a referral.</p></header>
    <ConsultationManager initialItems={data.consultations} products={data.products} />
  </main>;
}
