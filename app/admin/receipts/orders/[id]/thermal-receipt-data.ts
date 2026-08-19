// Relative, not aliased: lib/thermal-receipt.test.ts runs this file under `node
// --test`, which has no tsconfig path mapping to resolve "@/lib" with.
import { vatIncludedIn, vatLabel } from "../../../../../lib/vat.ts";

export type ReceiptMoney = string | number;

export type ReceiptOrder = {
  id: number;
  orderNumber: string;
  customerName: string;
  phone: string;
  email: string | null;
  fulfilmentMethod: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentReference: string | null;
  amountPaid: ReceiptMoney;
  subtotal: ReceiptMoney;
  deliveryFee: ReceiptMoney;
  discount: ReceiptMoney;
  total: ReceiptMoney;
  suggestedBranchId: number | null;
  createdAt: string;
  vat?: ReceiptMoney | null;
  amountTendered?: ReceiptMoney | null;
  change?: ReceiptMoney | null;
};

export type ReceiptItem = {
  productName: string;
  quantity: number;
  unitPrice: ReceiptMoney;
  lineTotal: ReceiptMoney;
  packSize?: string | null;
};

export type ReceiptPayment = {
  method: string;
  channel: "ONLINE" | "POS";
  status: string;
  amount: ReceiptMoney;
  receiptNumber: string | null;
  createdAt: string;
  verifiedAt?: string | null;
};

export type ReceiptBranch = {
  id: number;
  name: string;
  code: string;
  phone: string;
  address: string;
};

export type ReceiptBusiness = {
  pharmacyName: string;
  phone: string | null;
  address: string | null;
  licenceNumber: string | null;
  taxNumber?: string | null;
  /** The admin switch. Off prints no VAT line whatever the rate says. */
  vatEnabled?: boolean | null;
  /** Shop-wide VAT percentage from admin settings; 0 or absent prints no VAT line. */
  vatRate?: string | number | null;
};

export type ReceiptApiData = {
  order: ReceiptOrder;
  items: ReceiptItem[];
  payments?: ReceiptPayment[];
  stores?: ReceiptBranch[];
  fulfilments?: Array<{ branchId: number }>;
  receipt?: { settings: ReceiptBusiness | null; servedBy: string | null };
};

export type ThermalReceiptProps = {
  order: ReceiptOrder;
  items: ReceiptItem[];
  payment: ReceiptPayment | null;
  branch: ReceiptBranch | null;
  business: ReceiptBusiness;
  servedBy: string | null;
  receiptNumber: string;
  /** "VAT (16% incl.)" — carries the rate, so a reprinted receipt still explains itself. */
  vatLabel: string;
  barcodeDataUrl?: string | null;
  logoDataUrl?: string | null;
};

export function paymentMethodLabel(method: string) {
  if (method === "MPESA_EXPRESS") return "M-Pesa Express";
  if (method === "MANUAL_MPESA" || method === "MPESA") return "M-Pesa Till";
  if (method === "CASH") return "Cash";
  return method.replaceAll("_", " ");
}

export function healthfieldReceiptNumber(orderId: number, branchCode?: string | null) {
  const sequence = String(orderId).padStart(7, "0");
  const branchSuffix = branchCode?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-1) || "";
  return `${sequence}${branchSuffix}`;
}

export function receiptDownloadFilename(order: Pick<ReceiptOrder, "id" | "customerName" | "orderNumber">, branchCode?: string | null) {
  const safe = (value: string) => value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const buyer = safe(order.customerName || "");
  const branch = safe(branchCode || "");
  const sequence = String(order.id).padStart(4, "0");
  const reference = branch ? `HF-${branch}-${sequence}` : safe(order.orderNumber) || `HF-${sequence}`;
  return `${buyer ? `${buyer}-` : ""}${reference}.pdf`;
}

export function prepareThermalReceipt(data: ReceiptApiData): Omit<ThermalReceiptProps, "barcodeDataUrl" | "logoDataUrl"> {
  const payment = data.payments?.find((entry) => entry.status === "PAID") ?? data.payments?.[0] ?? null;
  const branchId = data.fulfilments?.find((entry) => entry.branchId)?.branchId ?? data.order.suggestedBranchId;
  const branch = data.stores?.find((entry) => entry.id === branchId) ?? null;
  const business = data.receipt?.settings ?? {
    pharmacyName: "Healthfield Pharmacy",
    phone: null,
    address: null,
    licenceNumber: null,
  };
  // Shelf prices include VAT, so the receipt discloses the tax inside the total rather
  // than adding to it — the printed total still matches the M-Pesa receipt to the
  // shilling. A figure already supplied with the order wins, so a POS sale that
  // recorded its own VAT is never overwritten by today's rate.
  const vat = business.vatEnabled === false ? null : data.order.vat ?? vatIncludedIn(data.order.total, business.vatRate);
  const servedBy = data.receipt?.servedBy ?? (payment?.channel === "ONLINE" ? "Online order" : payment?.channel === "POS" ? "POS terminal" : null);
  return {
    order: { ...data.order, vat },
    items: data.items,
    payment,
    branch,
    business,
    servedBy,
    receiptNumber: healthfieldReceiptNumber(data.order.id, branch?.code),
    vatLabel: vatLabel(business.vatEnabled === false ? 0 : business.vatRate),
  };
}
