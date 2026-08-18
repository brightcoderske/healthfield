export const STAFF_PERMISSION_VALUES = [
  "DASHBOARD_VIEW",
  "PRODUCTS_VIEW",
  "POS_USE",
  "ORDERS_VIEW",
  "ORDERS_PROCESS",
  "PAST_ORDERS_VIEW",
  "RECEIPTS_VIEW",
  "PAYMENTS_REVIEW",
  "PRESCRIPTIONS_VIEW",
  "PRESCRIPTIONS_PROCESS",
  "CONSULTATIONS_VIEW",
  "CONSULTATIONS_PROCESS",
  "INVENTORY_VIEW",
  "INVENTORY_UPDATE",
  "OFFERS_MANAGE",
  "BLOGS_MANAGE",
] as const;

export type StaffPermission = typeof STAFF_PERMISSION_VALUES[number];

export const STAFF_PERMISSION_GROUPS: ReadonlyArray<{
  label: string;
  permissions: ReadonlyArray<{ value: StaffPermission; label: string; description: string }>;
}> = [
  { label: "Overview and catalogue", permissions: [
    { value:"DASHBOARD_VIEW", label:"View dashboard", description:"Open the shop dashboard and shop-scoped reports." },
    { value:"PRODUCTS_VIEW", label:"View products", description:"Browse the active product catalogue and prices." },
  ] },
  { label: "Sales and orders", permissions: [
    { value:"POS_USE", label:"Make counter sales", description:"Use the shop-scoped point of sale and its payment flow." },
    { value:"ORDERS_VIEW", label:"View active orders", description:"Open the shared active-order queue and order details." },
    { value:"ORDERS_PROCESS", label:"Process orders", description:"Change order details, fulfilment shops and statuses." },
    { value:"PAST_ORDERS_VIEW", label:"View past orders", description:"Open dispatched, completed and cancelled orders." },
    { value:"RECEIPTS_VIEW", label:"View receipts", description:"Print or download customer order receipts." },
    { value:"PAYMENTS_REVIEW", label:"Review payments", description:"Approve or reject manual payment evidence." },
  ] },
  { label: "Pharmacy and stock", permissions: [
    { value:"PRESCRIPTIONS_VIEW", label:"View prescriptions", description:"Open prescription documents and the shared review queue." },
    { value:"PRESCRIPTIONS_PROCESS", label:"Process prescriptions", description:"Start, save, approve, clarify or decline reviews." },
    { value:"INVENTORY_VIEW", label:"View inventory", description:"See stock for the staff member's assigned shop." },
    { value:"INVENTORY_UPDATE", label:"Update inventory", description:"Change available, reserved and reorder quantities for that shop." },
  ] },
  { label: "Consultations", permissions: [
    { value:"CONSULTATIONS_VIEW", label:"View consultations", description:"Open prescription consultation requests and their conversations." },
    { value:"CONSULTATIONS_PROCESS", label:"Conduct consultations", description:"Reply to patients and issue prescriptions, OTC advice or referrals. Grant only to registered prescribers." },
  ] },
  { label: "Storefront content", permissions: [
    { value:"OFFERS_MANAGE", label:"Manage offers", description:"Create, edit, publish and remove product offers." },
    { value:"BLOGS_MANAGE", label:"Manage blogs", description:"Create, edit, publish and remove blog articles." },
  ] },
];

// Existing staff keep their current operational access after migration. An owner can
// then narrow each account deliberately without a surprise lockout during rollout.
// Consultation permissions are deliberately absent: issuing a prescription is a
// prescriber's act, so it is granted deliberately per account rather than handed to
// every new staff member the way dispensing access is.
export const DEFAULT_STAFF_PERMISSIONS: readonly StaffPermission[] = STAFF_PERMISSION_VALUES.filter(
  (permission) => permission !== "CONSULTATIONS_VIEW" && permission !== "CONSULTATIONS_PROCESS",
);

export const STAFF_PERMISSION_SET = new Set<string>(STAFF_PERMISSION_VALUES);

export function normalizeStaffPermissions(values: readonly string[] | null | undefined): StaffPermission[] {
  return [...new Set((values || []).filter((value): value is StaffPermission => STAFF_PERMISSION_SET.has(value)))];
}

export function hasStaffPermission(role: string, permissions: readonly string[] | undefined, permission: StaffPermission) {
  return role === "ADMIN" || role === "SUPER_ADMIN" || (role === "STAFF" && Boolean(permissions?.includes(permission)));
}

export const STAFF_PERMISSION_PATHS: ReadonlyArray<{ permission: StaffPermission; href: string }> = [
  { permission:"DASHBOARD_VIEW", href:"/staff" },
  { permission:"POS_USE", href:"/staff/sales" },
  { permission:"PRODUCTS_VIEW", href:"/staff/products" },
  { permission:"INVENTORY_VIEW", href:"/staff/inventory" },
  { permission:"ORDERS_VIEW", href:"/staff/orders" },
  { permission:"PAST_ORDERS_VIEW", href:"/staff/past-orders" },
  { permission:"PRESCRIPTIONS_VIEW", href:"/staff/prescriptions" },
  { permission:"CONSULTATIONS_VIEW", href:"/staff/consultations" },
  { permission:"OFFERS_MANAGE", href:"/staff/offers" },
  { permission:"BLOGS_MANAGE", href:"/staff/blogs" },
];

export function firstStaffPath(role: string, permissions: readonly string[] | undefined) {
  return STAFF_PERMISSION_PATHS.find((item) => hasStaffPermission(role, permissions, item.permission))?.href || "/unauthorized";
}
