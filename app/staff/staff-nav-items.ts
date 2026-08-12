import { Boxes, ClipboardList, History, LayoutDashboard, ShieldCheck, ShoppingBasket } from "lucide-react";

export const staffNavGroups = [
  { label: "Shop operations", items: [
    ["/staff", "Dashboard", LayoutDashboard],
    ["/staff/sales", "Point of sale", ShoppingBasket],
    ["/staff/inventory", "Inventory", Boxes],
  ] },
  { label: "Shared queues", items: [
    ["/staff/orders", "Orders", ClipboardList],
    ["/staff/past-orders", "Past orders", History],
    ["/staff/prescriptions", "Prescriptions", ShieldCheck],
  ] },
] as const;
