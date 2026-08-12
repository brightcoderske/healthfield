import Link from "next/link";
import { OrderList } from "@/app/admin/orders/order-list";
import { isPastOrder, pastOrderStatuses } from "@/app/admin/order-buckets";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export const dynamic="force-dynamic";
type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;paymentMethod:string;amountPaid:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};

export default async function StaffPastOrdersPage(){
  await requireStaffPermission("PAST_ORDERS_VIEW");
  const {orders}=await backendJson<{orders:Order[]}>("/v1/views/staff/past-orders");
  return <main className="data-page"><header><Link href="/staff/orders">← Orders</Link><h1>Past orders</h1></header><OrderList orders={orders.filter(order=>isPastOrder(order.status))} statuses={pastOrderStatuses} filterKey="healthfield-staff-past-order-status-filters" pageSize={50} emptyHint="Orders appear here once dispatched or completed." basePath="/staff/orders" allowDelete={false}/></main>;
}
