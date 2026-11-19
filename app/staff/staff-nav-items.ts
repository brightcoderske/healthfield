import { BookOpen, Boxes, Stethoscope, ClipboardList, History, LayoutDashboard, Megaphone, MessageSquareText, Percent, Pill, ShieldCheck, ShoppingBasket } from "lucide-react";
import type { StaffPermission } from "@/lib/staff-permissions";

// The last field is the permission that shows the tab, or a list of which any one is enough.
export type StaffNavItem = readonly [string, string, typeof LayoutDashboard, StaffPermission | readonly StaffPermission[]];

export const staffNavGroups = [
  { label: "Shop operations", items: [
    ["/staff", "Dashboard", LayoutDashboard, "DASHBOARD_VIEW"],
    ["/staff/sales", "Point of sale", ShoppingBasket, "POS_USE"],
    // One page: it lists the catalogue for viewing, and becomes the product editor for whoever may manage it.
    ["/staff/products", "Products", Pill, ["PRODUCTS_VIEW", "PRODUCTS_MANAGE"]],
    ["/staff/inventory", "Inventory", Boxes, "INVENTORY_VIEW"],
  ] },
  { label: "Shared queues", items: [
    ["/staff/orders", "Orders", ClipboardList, "ORDERS_VIEW"],
    ["/staff/past-orders", "Past orders", History, "PAST_ORDERS_VIEW"],
    ["/staff/prescriptions", "Prescriptions", ShieldCheck, "PRESCRIPTIONS_VIEW"],
    ["/staff/consultations", "Consultations", Stethoscope, "CONSULTATIONS_VIEW"],
  ] },
  { label: "Storefront content", items: [
    ["/staff/offers", "Offers", Percent, "OFFERS_MANAGE"],
    ["/staff/blogs", "Blogs", BookOpen, "BLOGS_MANAGE"],
  ] },
  { label: "Customer messaging", items: [
    ["/staff/sms", "SMS reports", MessageSquareText, "SMS_VIEW"],
    ["/staff/campaigns", "Campaigns", Megaphone, "CAMPAIGNS_MANAGE"],
  ] },
] as const;
