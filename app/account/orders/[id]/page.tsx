import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type OrderData = { order:{orderNumber:string;status:string;createdAt:string;fulfilmentMethod:string;paymentStatus:string;deliveryArea:string|null;deliveryAddress:string|null;total:string};items:Array<{id:number;productName:string;quantity:number;unitPrice:string;lineTotal:string}> };

export default async function CustomerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["CUSTOMER"]);
  const id = Number((await params).id);
  let data: OrderData;
  try { data = await backendJson<OrderData>(`/v1/views/account/orders/${id}`); }
  catch (error) { if (error instanceof BackendError && error.status === 404) notFound(); throw error; }
  const { order, items } = data;
  return <main className="order-detail">
    <header><a href="/account#orders">← My orders</a><a href="/#products">Continue shopping</a></header>
    <section>
      <span className="order-status">{order.status.replaceAll("_", " ")}</span>
      <h1>{order.orderNumber}</h1>
      <p>Placed {new Date(order.createdAt).toLocaleString()}</p>
      <div className="order-meta"><span><small>Fulfilment</small><strong>{order.fulfilmentMethod}</strong></span><span><small>Payment</small><strong>{order.paymentStatus}</strong></span><span><small>Deliver to</small><strong>{order.deliveryArea || order.deliveryAddress || "Store pickup"}</strong></span></div>
      <h2>Order items</h2>
      <div className="order-items-table">
        <div className="order-items-head"><span>Product</span><span>Quantity</span><span>Amount</span></div>
        {items.map((item) => <article key={item.id}><span><strong>{item.productName}</strong><small>KES {Number(item.unitPrice).toLocaleString()} each</small></span><b>{item.quantity}</b><b>KES {Number(item.lineTotal).toLocaleString()}</b></article>)}
      </div>
      <footer><span>Total</span><strong>KES {Number(order.total).toLocaleString()}</strong></footer>
    </section>
  </main>;
}
