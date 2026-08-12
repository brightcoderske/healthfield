import { Activity, BookOpen, Boxes, Building2, ClipboardList, History, Megaphone, Percent, LayoutDashboard, LayoutList, MessageSquareText, Pill, Settings, ShieldCheck, ShoppingBasket, UserCog, Users } from "lucide-react";

export const adminNavGroups = [
  { label: "Daily operations", items: [
    ["/admin", "Dashboard", LayoutDashboard],
    ["/admin/walk-in-sales", "Walk-in sale", ShoppingBasket],
    ["/admin/orders", "Orders", ClipboardList],
    ["/admin/past-orders", "Past orders", History],
    ["/admin/prescriptions", "Prescriptions", ShieldCheck],
    ["/admin/chats", "Chats", MessageSquareText],
  ] },
  { label: "Stock and catalogue", items: [
    ["/admin/inventory", "Inventory", Boxes],
    ["/admin/products", "Products", Pill],
    ["/admin/taxonomy", "Categories", LayoutList],
    ["/admin/stores", "Stores", Building2],
  ] },
  { label: "Customers and growth", items: [
    ["/admin/customers", "Customers", Users],
    ["/admin/offers", "Offers", Percent],
    ["/admin/promotional-banners", "Promotional banners", Megaphone],
    ["/admin/campaigns", "Campaigns", MessageSquareText],
    ["/admin/blogs", "Blogs", BookOpen],
  ] },
  { label: "Administration", items: [
    ["/admin/staff", "Staff", UserCog],
    ["/admin/activity", "Activity log", Activity],
    ["/admin/settings", "Settings", Settings],
  ] },
] as const;
