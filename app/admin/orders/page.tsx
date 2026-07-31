import { desc } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { SearchableTable } from "../searchable-table";
export const dynamic="force-dynamic";
export default async function OrdersPage(){const rows=await getDb().select().from(orders).orderBy(desc(orders.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Orders</h1><p>Every customer order across all stores.</p></header><SearchableTable columns={["Order & customer","Status","Payment / delivery","Total"]} placeholder="Search order number, customer, phone or status" rows={rows.map(row=>({id:row.id,cells:[{primary:row.orderNumber,secondary:`${row.customerName} · ${row.phone}`,href:`/admin/orders/${row.id}`},{primary:row.status.replaceAll("_"," "),secondary:row.createdAt.toLocaleDateString()},{primary:row.paymentStatus,secondary:row.fulfilmentMethod},{primary:`KES ${Number(row.total).toLocaleString()}`,secondary:row.deliveryArea||"No area"}]}))} empty={<><ClipboardList/><strong>No orders yet</strong><span>Completed checkouts appear here.</span></>}/></main>}
