import { desc,eq } from "drizzle-orm";
import { Users } from "lucide-react";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { SearchableTable } from "../searchable-table";
export const dynamic="force-dynamic";
export default async function CustomersPage(){const rows=await getDb().select().from(users).where(eq(users.role,"CUSTOMER")).orderBy(desc(users.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Customers</h1><p>Registered Healthfield customer accounts.</p></header><SearchableTable columns={["Customer","Phone","Status","Joined"]} placeholder="Search customer name, email or phone" rows={rows.map(row=>({id:row.id,cells:[{primary:`${row.firstName} ${row.lastName}`,secondary:row.email},{primary:row.phone||"No phone"},{primary:row.isActive?"Active":"Suspended"},{primary:row.createdAt.toLocaleDateString()}]}))} empty={<><Users/><strong>No registered customers</strong><span>New registrations appear here.</span></>}/></main>}
