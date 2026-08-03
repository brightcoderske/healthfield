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
  items: Array<{ id: number; productId: number | null; productName: string; quantity: number; unitPrice: string; lineTotal: string }>;
  stores?: Array<{ id: number; name: string }>;
  fulfilments?: Array<{ orderItemId: number; branchId: number; quantityReserved: number; quantityPacked: number; status: "UNASSIGNED" | "RESERVED" | "PARTIALLY_RESERVED" | "PACKED" | "READY" | "UNAVAILABLE" | "REPLACED" }>;
  stock?: Array<{ productId: number; branchId: number; available: number }>;
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
  return <><a style={{position:"fixed",zIndex:20,right:24,top:18,padding:"10px 14px",borderRadius:8,color:"white",background:"#1d4d83",fontSize:11,fontWeight:800}} href={`/admin/receipts/orders/${id}`} target="_blank">Print colour receipt</a><OrderStatusManager order={{ ...data.order, id }} items={data.items ?? []} stores={data.stores ?? []} fulfilments={data.fulfilments ?? []} stock={data.stock ?? []} /></>;
}
