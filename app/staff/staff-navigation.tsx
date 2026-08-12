"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasStaffPermission, type StaffPermission } from "@/lib/staff-permissions";
import { staffNavGroups } from "./staff-nav-items";
import { StaffMobileMenu } from "./staff-mobile-menu";

function active(path:string, href:string) { return href === "/staff" ? path === href : path.startsWith(href); }

export function StaffNavigation({ firstName, branchName, counts, role, permissions }: { firstName:string; branchName:string; counts:{newOrders:number;pendingPrescriptions:number};role:string;permissions:StaffPermission[] }) {
  const path=usePathname();
  const badge=(href:string)=>href==="/staff/orders"?counts.newOrders:href==="/staff/prescriptions"?counts.pendingPrescriptions:0;
  const groups=staffNavGroups.map(group=>({...group,items:group.items.filter(([, , ,permission])=>hasStaffPermission(role,permissions,permission))})).filter(group=>group.items.length);
  const primary=groups.flatMap(group=>group.items).slice(0,4);
  return <><aside className="admin-sidebar"><Link prefetch={false} className="admin-brand" href="/staff"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={90}/></Link><nav>{groups.map(group=><section className="admin-nav-group" key={group.label}><small>{group.label}</small>{group.items.map(([href,label,Icon])=><Link prefetch={false} className={active(path,href)?"active":""} href={href} key={href}><Icon/>{label}{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}</section>)}</nav><div className="admin-user"><span>{firstName.slice(0,1)}</span><div><strong>{firstName}</strong><small>{branchName}</small></div></div><form className="admin-sidebar-logout" action="/api/auth/logout" method="post"><button>Log out</button></form></aside><nav className="admin-mobile-nav">{primary.map(([href,label,Icon])=><Link prefetch={false} className={active(path,href)?"active":""} href={href} key={href}><Icon/><span>{label==="Point of sale"?"POS":label}</span>{badge(href)>0?<b>{badge(href)}</b>:null}</Link>)}<StaffMobileMenu counts={counts} role={role} permissions={permissions}/></nav></>;
}
