"use client";
import { Boxes, Building2, ClipboardList, Menu, MessageSquareText, Pill, Settings, ShieldCheck, UserCog, Users } from "lucide-react";
export function AdminMobileMenu(){
 return <><button className="admin-more-trigger" popoverTarget="admin-mobile-drawer"><Menu/><span>More</span></button><div id="admin-mobile-drawer" popover="auto" className="admin-mobile-drawer"><header><strong>Administration</strong><button popoverTarget="admin-mobile-drawer" popoverTargetAction="hide">Close</button></header><nav><a href="/admin/orders"><ClipboardList/> Orders</a><a href="/admin/products"><Pill/> Products</a><a href="/admin/inventory"><Boxes/> Inventory</a><a href="/admin/prescriptions"><ShieldCheck/> Prescriptions</a><a href="/admin/customers"><Users/> Customers</a><a href="/admin/staff"><UserCog/> Staff</a><a href="/admin/stores"><Building2/> Stores</a><a href="/admin/campaigns"><MessageSquareText/> Campaigns</a><a href="/admin/settings"><Settings/> Settings</a></nav></div></>
}
