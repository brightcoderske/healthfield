import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import type { OrderFulfilmentMethod, OrderStatus } from "@/lib/order-status-transitions";
import { OrderStatusManager } from "./order-status-manager";
import { OrderReceiptActions } from "./order-receipt-actions";

export const dynamic = "force-dynamic";

type Data = {
  order: {
    id: number;
    orderNumber: string;
    status: OrderStatus;
    customerName: string;
    phone: string;
    email: string | null;
    fulfilmentMethod: OrderFulfilmentMethod;
    paymentStatus: string;
    paymentMethod: string;
    paymentReference: string | null;
    amountPaid: string;
    deliveryAddress: string | null;
    deliveryArea: string | null;
    deliveryLatitude: string | null;
    deliveryLongitude: string | null;
    total: string;
  };
  items: Array<{ id: number; productId: number | null; productName: string; quantity: number; unitPrice: string; lineTotal: string }>;
  stores?: Array<{ id: number; name: string }>;
  fulfilments?: Array<{ orderItemId: number; branchId: number; quantityReserved: number; quantityPacked: number; status: "UNASSIGNED" | "RESERVED" | "PARTIALLY_RESERVED" | "PACKED" | "READY" | "UNAVAILABLE" | "REPLACED" }>;
  stock?: Array<{ productId: number; branchId: number; available: number }>;
  payments?: Array<{id:number;method:"MPESA_EXPRESS"|"MANUAL_MPESA"|"CASH";channel:"ONLINE"|"POS";status:string;amount:string;phone:string|null;receiptNumber:string|null;manualMessage:string|null;resultDescription:string|null;createdAt:string}>;
};

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  let data: Data;
  try {
    data = await backendJson<Data>(`/v1/views/admin/orders/${id}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
  return <><OrderReceiptActions orderId={id} /><OrderStatusManager order={{ ...data.order, id }} items={data.items ?? []} stores={data.stores ?? []} fulfilments={data.fulfilments ?? []} stock={data.stock ?? []} payments={data.payments??[]} /></>;
}
