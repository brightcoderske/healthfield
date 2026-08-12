"use client";

import { ClipboardList, LayoutDashboard, ShieldCheck, ShoppingBasket } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { staffNavGroups } from "./staff-nav-items";
import { StaffMobileMenu } from "./staff-mobile-menu";

function active(path:string, href:string) { return href === "/staff" ? path === href : path.startsWith(href); }

export function StaffNavigation({ firstName, branchName, counts }: { firstName:string; branchName:string; counts:{newOrders:number;pendingPrescriptions:number} }) {
  const path=usePathname();
  const badge=(href:string)=>href==="/staff/orders"?counts.newOrders:href==="/staff/prescriptions"?counts.pendingPrescriptions:0;
  return <><aside className="admin-sidebar"><Link prefetch={false} className="admin-brand" href="/staff"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={90}/></Link><nav>{staffNavGroups.map(group=><section className="admin-nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([href,label,Icon])=><Link prefetch={false} className={active(path,href)?"active":""} href={href} key={href}><Icon/>{label}{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}</section>)}</nav><div className="admin-user"><span>{firstName.slice(0,1)}</span><div><strong>{firstName}</strong><small>{branchName}</small></div></div><form className="admin-sidebar-logout" action="/api/auth/logout" method="post"><button>Log out</button></form></aside><nav className="admin-mobile-nav"><Link prefetch={false} className={active(path,"/staff")?"active":""} href="/staff"><LayoutDashboard/><span>Home</span></Link><Link prefetch={false} className={active(path,"/staff/orders")?"active":""} href="/staff/orders"><ClipboardList/><span>Orders</span>{counts.newOrders>0?<b>{counts.newOrders}</b>:null}</Link><Link prefetch={false} className={active(path,"/staff/sales")?"active":""} href="/staff/sales"><ShoppingBasket/><span>POS</span></Link><Link prefetch={false} className={active(path,"/staff/prescriptions")?"active":""} href="/staff/prescriptions"><ShieldCheck/><span>Rx</span>{counts.pendingPrescriptions>0?<b>{counts.pendingPrescriptions}</b>:null}</Link><StaffMobileMenu counts={counts}/></nav></>;
}
