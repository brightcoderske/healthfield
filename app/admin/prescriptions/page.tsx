import { desc } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/db";
import { prescriptions } from "@/db/schema";
export const dynamic="force-dynamic";
export default async function PrescriptionsPage(){const rows=await getDb().select().from(prescriptions).orderBy(desc(prescriptions.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Prescriptions</h1><p>Protected pharmacist review queue.</p></header><section>{rows.length===0?<div className="database-empty"><ShieldCheck/><strong>No prescriptions awaiting review</strong><span>Customer uploads appear here securely.</span></div>:rows.map(row=><article key={row.id}><div><strong>{row.originalFilename}</strong><small>{row.createdAt.toLocaleString()}</small></div><span>{row.status.replaceAll("_"," ")}</span><span>{row.mimeType}</span><a href={`/api/prescriptions/${row.id}/download`} target="_blank">Review file</a></article>)}</section></main>}
