"use client";

import { Bell, BellOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasStaffPermission, type StaffPermission } from "@/lib/staff-permissions";
import { staffNavGroups } from "./staff-nav-items";
import { StaffMobileMenu } from "./staff-mobile-menu";
import { useLiveCounts, type NavigationCounts } from "../use-live-counts";

function active(path:string, href:string) { return href === "/staff" ? path === href : path.startsWith(href); }

export function StaffNavigation({ firstName, branchName, counts: initialCounts, role, permissions }: { firstName:string; branchName:string; counts:NavigationCounts;role:string;permissions:StaffPermission[] }) {
  const path=usePathname();
  const {counts,muted,toggleMute}=useLiveCounts(initialCounts,"/api/notifications/staff");
  const badge=(href:string)=>href==="/staff/orders"?counts.newOrders:href==="/staff/prescriptions"?counts.pendingPrescriptions||0:href==="/staff/consultations"?counts.pendingConsultations||0:0;
  const groups=staffNavGroups.map(group=>({...group,items:group.items.filter(([, , ,permission])=>hasStaffPermission(role,permissions,permission))})).filter(group=>group.items.length);
  const primary=groups.flatMap(group=>group.items).slice(0,4);
  return <><aside className="admin-sidebar"><Link prefetch={false} className="admin-brand" href="/staff"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={90}/></Link><nav>{groups.map(group=><section className="admin-nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([href,label,Icon])=><Link prefetch={false} className={active(path,href)?"active":""} href={href} key={href}><Icon/>{label}{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}</section>)}</nav><div className="admin-user"><span>{firstName.slice(0,1)}</span><div><strong>{firstName}</strong><small>{branchName}</small></div></div><button className="rx-alert-toggle" type="button" onClick={toggleMute} aria-pressed={!muted}>{muted?<BellOff/>:<Bell/>}{muted?"Alert sound off":"Alert sound on"}</button><form className="admin-sidebar-logout" action="/api/auth/logout" method="post"><button>Log out</button></form></aside><nav className="admin-mobile-nav">{primary.map(([href,label,Icon])=><Link prefetch={false} className={active(path,href)?"active":""} href={href} key={href}><Icon/><span>{label==="Point of sale"?"POS":label}</span>{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}<StaffMobileMenu counts={counts} role={role} permissions={permissions}/></nav></>;
}
