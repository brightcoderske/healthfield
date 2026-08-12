import { OrderList } from "@/app/admin/orders/order-list";
import { activeOrderStatuses, isPastOrder } from "@/app/admin/order-buckets";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export const dynamic="force-dynamic";
type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;paymentMethod:string;amountPaid:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};

export default async function StaffOrdersPage(){
  await requireStaffPermission("ORDERS_VIEW");
  const {orders}=await backendJson<{orders:Order[]}>("/v1/views/staff/orders");
  const active=orders.filter(order=>!isPastOrder(order.status));
  return <main className="data-page"><header><a href="/staff">← Dashboard</a><h1>Orders</h1><p>Shared queue: every shop can see and process customer orders.</p></header><OrderList orders={active} statuses={activeOrderStatuses} filterKey="healthfield-staff-order-status-filters" emptyHint="Completed and dispatched orders are on the Past orders tab." basePath="/staff/orders" allowDelete={false}/></main>;
}
