import {
  Boxes,
  Building2,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  Package,
  Pill,
  Settings,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  Users,
  UserCog,
} from "lucide-react";
import Image from "next/image";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { AdminMobileMenu } from "./admin-mobile-menu";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireRole(["ADMIN", "SUPER_ADMIN"]);
  const {newOrders,pendingPrescriptions,activeProducts,lowStock,customers,newChats,recentOrders}=await backendJson<{newOrders:number;pendingPrescriptions:number;activeProducts:number;lowStock:number;customers:number;newChats:number;recentOrders:Array<{id:number;orderNumber:string;customerName:string;deliveryArea:string|null;fulfilmentMethod:string;status:string;paymentStatus:string;total:string}>}>("/v1/views/admin/dashboard");

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={90} /></a>
        <nav>
          <a className="active" href="/admin"><LayoutDashboard /> Overview</a>
          <a href="/admin/orders"><ClipboardList /> Orders {newOrders > 0 && <b>{newOrders}</b>}</a>
          <a href="/admin/products"><Pill /> Products</a>
          <a href="/admin/catalogue"><Package /> Categories & conditions</a>
          <a href="/admin/inventory"><Boxes /> Inventory</a>
          <a href="/admin/prescriptions"><ShieldCheck /> Prescriptions {pendingPrescriptions > 0 && <b>{pendingPrescriptions}</b>}</a>
          <a href="/admin/customers"><Users /> Customers</a>
          <a href="/admin/staff"><UserCog /> Staff</a>
          <a href="/admin/stores"><Building2 /> Stores</a>
          <a href="/admin/campaigns"><MessageSquareText /> Campaigns</a>
          <a href="/admin/chats"><MessageSquareText /> Chats {newChats > 0 && <b>{newChats}</b>}</a>
          <a href="/admin/settings"><Settings /> Settings</a>
        </nav>
        <div className="admin-user"><span>{session.firstName.slice(0,1)}</span><div><strong>{session.firstName}</strong><small>{session.role.replace("_"," ")}</small></div></div>
      </aside>

      <main className="admin-main">
        <header className="admin-header"><div><span className="eyebrow">Healthfield administration</span><h1>{session.firstName}</h1><p>Orders, prescriptions, products and branch stock.</p></div><form action="/api/auth/logout" method="post"><button className="dashboard-logout">Log out</button></form></header>
        <section className="metric-grid">
          <article><span className="metric-icon purple"><ClipboardList /></span><div><small>New orders</small><strong>{newOrders}</strong><em>Awaiting action</em></div></article>
          <article><span className="metric-icon pink"><ShieldCheck /></span><div><small>Pending prescriptions</small><strong>{pendingPrescriptions}</strong><em>Needs review</em></div></article>
          <article><span className="metric-icon green"><Pill /></span><div><small>Active products</small><strong>{activeProducts}</strong><em>Shared catalogue</em></div></article>
          <article><span className="metric-icon orange"><TriangleAlert /></span><div><small>Low-stock records</small><strong>{lowStock}</strong><em>Branch inventory</em></div></article>
        </section>
        <section className="admin-grid single">
          <article className="admin-card orders-card">
            <div className="card-heading"><div><h2>Recent orders</h2><p>{customers} registered customers</p></div><a href="/admin/orders">View all</a></div>
            <div className="order-list">
              {recentOrders.length === 0 ? <div className="database-empty"><Package /><strong>No orders yet</strong><span>New checkout orders will appear here immediately.</span></div> : recentOrders.map((order) => (
                <a className="order-row" href={`/admin/orders/${order.id}`} key={order.id}>
                  <span className="order-avatar"><Package /></span>
                  <div><strong>{order.orderNumber}</strong><small>{order.customerName} · {order.deliveryArea || order.fulfilmentMethod}</small></div>
                  <span className="status purple">{order.status.replaceAll("_"," ")}</span>
                  <span className="branch">{order.paymentStatus}</span>
                  <strong className="order-total">KES {Number(order.total).toLocaleString()}</strong>
                </a>
              ))}
            </div>
          </article>
        </section>
      </main>
      <nav className="admin-mobile-nav"><a className="active" href="/admin"><LayoutDashboard /><span>Home</span></a><a href="/admin/orders"><ClipboardList /><span>Orders</span></a><a href="/admin/products"><Pill /><span>Products</span></a><a href="/admin/inventory"><Boxes /><span>Stock</span></a><AdminMobileMenu counts={{newOrders,newChats}}/></nav>
    </div>
  );
}
