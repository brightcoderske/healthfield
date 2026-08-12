import { BookOpen, Boxes, ClipboardList, History, LayoutDashboard, Percent, Pill, ShieldCheck, ShoppingBasket } from "lucide-react";
import type { StaffPermission } from "@/lib/staff-permissions";

export type StaffNavItem = readonly [string, string, typeof LayoutDashboard, StaffPermission];

export const staffNavGroups = [
  { label: "Shop operations", items: [
    ["/staff", "Dashboard", LayoutDashboard, "DASHBOARD_VIEW"],
    ["/staff/sales", "Point of sale", ShoppingBasket, "POS_USE"],
    ["/staff/products", "Products", Pill, "PRODUCTS_VIEW"],
    ["/staff/inventory", "Inventory", Boxes, "INVENTORY_VIEW"],
  ] },
  { label: "Shared queues", items: [
    ["/staff/orders", "Orders", ClipboardList, "ORDERS_VIEW"],
    ["/staff/past-orders", "Past orders", History, "PAST_ORDERS_VIEW"],
    ["/staff/prescriptions", "Prescriptions", ShieldCheck, "PRESCRIPTIONS_VIEW"],
  ] },
  { label: "Storefront content", items: [
    ["/staff/offers", "Offers", Percent, "OFFERS_MANAGE"],
    ["/staff/blogs", "Blogs", BookOpen, "BLOGS_MANAGE"],
  ] },
] as const;
