import { desc } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/db";
import { prescriptions } from "@/db/schema";
import { SearchableTable } from "../searchable-table";
export const dynamic="force-dynamic";
export default async function PrescriptionsPage(){const rows=await getDb().select().from(prescriptions).orderBy(desc(prescriptions.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Prescriptions</h1><p>Protected pharmacist review queue.</p></header><SearchableTable columns={["File","Status","File type","Action"]} placeholder="Search filename, type or review status" rows={rows.map(row=>({id:row.id,cells:[{primary:row.originalFilename,secondary:row.createdAt.toLocaleString()},{primary:row.status.replaceAll("_"," ")},{primary:row.mimeType},{primary:"Review file",href:`/api/prescriptions/${row.id}/download`,external:true}]}))} empty={<><ShieldCheck/><strong>No prescriptions awaiting review</strong><span>Customer uploads appear here securely.</span></>}/></main>}
