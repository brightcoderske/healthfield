"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { staffNavGroups } from "./staff-nav-items";

export function StaffMobileMenu({ counts }: { counts: { newOrders:number; pendingPrescriptions:number } }) {
  const badge = (href:string) => href === "/staff/orders" ? counts.newOrders : href === "/staff/prescriptions" ? counts.pendingPrescriptions : 0;
  return <><button className="admin-more-trigger" popoverTarget="staff-mobile-drawer"><Menu/><span>More</span></button><div id="staff-mobile-drawer" popover="auto" className="admin-mobile-drawer"><header><strong>Shop operations</strong><button popoverTarget="staff-mobile-drawer" popoverTargetAction="hide">Close</button></header><nav onClick={(event)=>{if((event.target as HTMLElement).closest("a")){const drawer=event.currentTarget.closest<HTMLElement>(".admin-mobile-drawer");window.setTimeout(()=>drawer?.hidePopover(),0)}}}>{staffNavGroups.map(group=><section className="admin-mobile-nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([href,label,Icon])=><Link prefetch={false} href={href} key={href}><Icon/>{label}{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}</section>)}</nav><form action="/api/auth/logout" method="post"><button><LogOut/> Log out</button></form></div></>;
}
