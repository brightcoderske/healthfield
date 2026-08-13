"use client";

import { Boxes, ClipboardList, LayoutDashboard, Pill } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavGroups } from "./admin-nav-items";
import { AdminMobileMenu } from "./admin-mobile-menu";

function active(path: string, href: string) {
  return href === "/admin" ? path === href : path.startsWith(href);
}

export function AdminNavigation({ firstName, role, counts }: { firstName: string; role: string; counts: { newOrders: number; newChats: number; unmatchedPayments?: number } }) {
  const path = usePathname();
  const badge = (href: string) => href === "/admin/orders" ? counts.newOrders : href === "/admin/chats" ? counts.newChats : href === "/admin/unmatched-payments" ? counts.unmatchedPayments || 0 : 0;
  return <>
    <aside className="admin-sidebar">
      <Link prefetch={false} className="admin-brand" href="/admin"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={90}/></Link>
      <nav>{adminNavGroups.map((group) => <section className="admin-nav-group" key={group.label}>
        <small>{group.label}</small>
        {group.items.map(([href, label, Icon]) => <Link prefetch={false} className={active(path, href) ? "active" : ""} href={href} key={href}><Icon/>{label}{badge(href) > 0 ? <b>{badge(href)}</b> : null}</Link>)}
      </section>)}</nav>
      <div className="admin-user"><span>{firstName.slice(0, 1)}</span><div><strong>{firstName}</strong><small>{role.replace("_", " ")}</small></div></div>
      <form className="admin-sidebar-logout" action="/api/auth/logout" method="post"><button>Log out</button></form>
    </aside>
    <nav className="admin-mobile-nav">
      <Link prefetch={false} className={active(path, "/admin") ? "active" : ""} href="/admin"><LayoutDashboard/><span>Home</span></Link>
      <Link prefetch={false} className={active(path, "/admin/orders") ? "active" : ""} href="/admin/orders"><ClipboardList/><span>Orders</span>{counts.newOrders > 0 ? <b>{counts.newOrders}</b> : null}</Link>
      <Link prefetch={false} className={active(path, "/admin/products") ? "active" : ""} href="/admin/products"><Pill/><span>Products</span></Link>
      <Link prefetch={false} className={active(path, "/admin/inventory") ? "active" : ""} href="/admin/inventory"><Boxes/><span>Stock</span></Link>
      <AdminMobileMenu counts={counts}/>
    </nav>
  </>;
}
