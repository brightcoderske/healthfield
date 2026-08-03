import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { OrderStatusManager } from "./order-status-manager";

export const dynamic = "force-dynamic";

type Data = {
  order: {
    id: number;
    orderNumber: string;
    status: string;
    customerName: string;
    phone: string;
    email: string | null;
    fulfilmentMethod: string;
    paymentStatus: string;
    deliveryAddress: string | null;
    deliveryArea: string | null;
    total: string;
  };
  items: Array<{ id: number; productName: string; quantity: number; unitPrice: string; lineTotal: string }>;
  stores?: Array<{ id: number; name: string }>;
  fulfilments?: Array<{ orderItemId: number; branchId: number; quantityReserved: number; quantityPacked: number; status: "UNASSIGNED" | "RESERVED" | "PARTIALLY_RESERVED" | "PACKED" | "READY" | "UNAVAILABLE" | "REPLACED" }>;
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
  return <OrderStatusManager order={{ ...data.order, id }} items={data.items ?? []} stores={data.stores ?? []} fulfilments={data.fulfilments ?? []} />;
}
