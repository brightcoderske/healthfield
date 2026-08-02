import { backendJson } from "@/lib/backend-api";
import { OrderList } from "./order-list";

export const dynamic = "force-dynamic";

type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};
export default async function OrdersPage(){const {orders}=await backendJson<{orders:Order[]}>("/v1/views/admin/orders");return <main className="data-page"><header><a href="/admin">← Dashboard</a><h1>Orders</h1><p>Every customer order across all stores.</p></header><OrderList orders={orders}/></main>}
