import { backendJson } from "@/lib/backend-api";
import { activeOrderStatuses, isPastOrder } from "../order-buckets";
import { OrderList } from "./order-list";

export const dynamic = "force-dynamic";

type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;paymentMethod:string;amountPaid:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};
export default async function OrdersPage(){
  const {orders}=await backendJson<{orders:Order[]}>("/v1/views/admin/orders");
  // Dispatched and completed orders live on the Past orders tab so this stays a
  // working queue rather than a full history.
  const active=orders.filter((order)=>!isPastOrder(order.status));
  return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Orders</h1></header><OrderList orders={active} statuses={activeOrderStatuses} emptyHint="Completed and dispatched orders are on the Past orders tab."/></main>
}
