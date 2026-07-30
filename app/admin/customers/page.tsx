import { desc,eq } from "drizzle-orm";
import { Users } from "lucide-react";
import { getDb } from "@/db";
import { users } from "@/db/schema";
export const dynamic="force-dynamic";
export default async function CustomersPage(){const rows=await getDb().select().from(users).where(eq(users.role,"CUSTOMER")).orderBy(desc(users.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Customers</h1><p>Registered Healthfield customer accounts.</p></header><section>{rows.length===0?<div className="database-empty"><Users/><strong>No registered customers</strong><span>New customer registrations appear here.</span></div>:rows.map(row=><article key={row.id}><div><strong>{row.firstName} {row.lastName}</strong><small>{row.email}</small></div><span>{row.phone||"No phone"}</span><span>{row.isActive?"Active":"Suspended"}</span><b>{row.createdAt.toLocaleDateString()}</b></article>)}</section></main>}
