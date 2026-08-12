import { backendJson } from "@/lib/backend-api";
import { PrescriptionManager, type PrescriptionProduct, type PrescriptionRecord } from "./prescription-manager";

export const dynamic = "force-dynamic";

export default async function PrescriptionsPage() {
  const data = await backendJson<{ prescriptions:PrescriptionRecord[];products:PrescriptionProduct[] }>("/v1/views/admin/prescriptions");
  return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Prescriptions</h1><p>Review the document, confirm medicines and send a locked proposal to the customer.</p></header><PrescriptionManager initialItems={data.prescriptions} products={data.products} customerProfileBase="/admin/customers" allowDelete/></main>;
}
