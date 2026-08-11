import { backendJson } from "@/lib/backend-api";
import { isPastOrder, pastOrderStatuses } from "../order-buckets";
import { OrderList } from "../orders/order-list";

export const dynamic = "force-dynamic";

type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;paymentMethod:string;amountPaid:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};
export default async function PastOrdersPage(){
  const {orders}=await backendJson<{orders:Order[]}>("/v1/views/admin/orders");
  const past=orders.filter((order)=>isPastOrder(order.status));
  return <main className="data-page"><header><a href="/admin/orders">← Orders</a><h1>Past orders</h1></header>
    <OrderList
      orders={past}
      statuses={pastOrderStatuses}
      filterKey="healthfield-past-order-status-filters"
      pageSize={50}
      emptyHint="Orders appear here once they are dispatched or marked complete."
    />
  </main>
}
