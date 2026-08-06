import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { PrescriptionManager } from "@/app/admin/prescriptions/prescription-manager";
export const dynamic="force-dynamic";
type Item={id:number;senderName:string|null;originalFilename:string;createdAt:string;status:string;mimeType:string;pharmacistNotes:string|null};
export default async function StaffPrescriptionsPage(){await requireRole(["STAFF","ADMIN","SUPER_ADMIN"]);const {prescriptions}=await backendJson<{prescriptions:Item[]}>("/v1/views/staff/prescriptions");return <main className="data-page"><header><a href="/staff">← Staff workspace</a><h1>Prescription queue</h1><p>Review uploaded prescriptions and keep customers informed.</p></header><PrescriptionManager initialItems={prescriptions}/></main>}
