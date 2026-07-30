import { desc } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
export const dynamic="force-dynamic";
export default async function OrdersPage(){const rows=await getDb().select().from(orders).orderBy(desc(orders.createdAt));return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Orders</h1><p>Every customer order across all stores.</p></header><section>{rows.length===0?<div className="database-empty"><ClipboardList/><strong>No orders yet</strong><span>Completed checkouts appear here.</span></div>:rows.map(row=><article key={row.id}><div><strong>{row.orderNumber}</strong><small>{row.customerName} · {row.phone}</small></div><span>{row.status.replaceAll("_"," ")}</span>{row.deliveryLatitude&&row.deliveryLongitude?<a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${row.deliveryLatitude},${row.deliveryLongitude}`}>View location</a>:<span>{row.paymentStatus}</span>}<b>KES {Number(row.total).toLocaleString()}</b></article>)}</section></main>}
