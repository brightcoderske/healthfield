import { count, desc, eq, sql } from "drizzle-orm";
import { Boxes, ClipboardCheck, MessageSquareText, PackageCheck, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { getDb } from "@/db";
import { branchInventory, orders, prescriptions } from "@/db/schema";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StaffDashboard() {
  const session = await requireRole(["STAFF", "ADMIN", "SUPER_ADMIN"]);
  const db = getDb();
  const [[{ newOrders }], [{ pending }], [{ lowStock }], queue] = await Promise.all([
    db.select({ newOrders: count() }).from(orders).where(eq(orders.status, "NEW")),
    db.select({ pending: count() }).from(prescriptions).where(eq(prescriptions.status, "RECEIVED")),
    db.select({ lowStock: count() }).from(branchInventory).where(sql`${branchInventory.quantityAvailable} <= ${branchInventory.reorderLevel}`),
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(10),
  ]);
  return <main className="role-dashboard"><header><Image src="/healthfield-logo.png" alt="Healthfield Pharmacy" width={210} height={75}/><div><small>Staff workspace</small><strong>{session.firstName}</strong><form action="/api/auth/logout" method="post"><button>Sign out</button></form></div></header><section className="role-heading"><span>All-branch fulfilment</span><h1>Orders requiring attention</h1><p>Reserve, pack and complete items from the best available branch.</p></section><div className="role-metrics"><article><ClipboardCheck/><span><strong>{newOrders}</strong><small>New orders</small></span></article><article><ShieldCheck/><span><strong>{pending}</strong><small>Prescriptions</small></span></article><article><Boxes/><span><strong>{lowStock}</strong><small>Low stock</small></span></article></div><section className="staff-queue"><div><h2>Live order queue</h2></div>{queue.length===0?<div className="database-empty"><PackageCheck/><strong>No active orders</strong><span>New customer orders will appear here.</span></div>:queue.map((order)=><article key={order.id}><PackageCheck/><span><strong>{order.orderNumber} · {order.customerName}</strong><small>{order.status.replaceAll("_"," ")} · {order.fulfilmentMethod}</small></span><em>{order.deliveryArea||"No area"}</em><button>Open</button></article>)}</section></main>;
}
