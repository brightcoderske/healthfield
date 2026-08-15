import { notFound } from "next/navigation";
import Link from "next/link";
import { BackendError, backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { OrderRecoveryActions } from "../order-recovery-actions";
import { ConfirmReceivedButton } from "./confirm-received-button";

export const dynamic = "force-dynamic";

type OrderData = { order:{id:number;orderNumber:string;status:string;createdAt:string;fulfilmentMethod:string;paymentStatus:string;paymentMethod:string;paymentReference:string|null;amountPaid:string;phone:string;deliveryArea:string|null;deliveryAddress:string|null;total:string};items:Array<{id:number;productId:number|null;productName:string;quantity:number;unitPrice:string;lineTotal:string}>;payment:{mpesaEnabled:boolean} };

export default async function CustomerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["CUSTOMER"]);
  const id = Number((await params).id);
  let data: OrderData;
  try { data = await backendJson<OrderData>(`/v1/views/account/orders/${id}`); }
  catch (error) { if (error instanceof BackendError && error.status === 404) notFound(); throw error; }
  const { order, items } = data;
  return <main className="order-detail">
    <header><Link href="/account#orders">← My orders</Link><Link href="/#products">Continue shopping</Link></header>
    <section>
      <span className="order-status">{order.status.replaceAll("_", " ")}</span>
      <h1>{order.orderNumber}</h1>
      <p>Placed {new Date(order.createdAt).toLocaleString()}</p>
      <div className="order-meta"><span><small>Fulfilment</small><strong>{order.fulfilmentMethod}</strong></span><span><small>Payment</small><strong className={`payment-type payment-type-${order.paymentMethod.toLowerCase()}`}>{order.paymentMethod==="MPESA_EXPRESS"?"M-Pesa Express":order.paymentMethod==="MANUAL_MPESA"?"Manual M-Pesa":"Cash"} · {order.paymentStatus}</strong></span><span><small>M-Pesa code / amount</small><strong>{order.paymentReference||"Awaiting verification"} · KES {Number(order.amountPaid).toLocaleString()}</strong></span><span><small>Deliver to</small><strong>{order.deliveryArea || order.deliveryAddress || "Store pickup"}</strong></span></div>
      <h2>Order items</h2>
      <div className="order-items-table">
        <div className="order-items-head"><span>Product</span><span>Quantity</span><span>Amount</span></div>
        {items.map((item) => <article key={item.id}><span><strong>{item.productName}</strong><small>KES {Number(item.unitPrice).toLocaleString()} each</small></span><b>{item.quantity}</b><b>KES {Number(item.lineTotal).toLocaleString()}</b></article>)}
      </div>
      <footer><span>Total</span><strong>KES {Number(order.total).toLocaleString()}</strong></footer>
      {order.fulfilmentMethod === "DELIVERY" && order.status === "OUT_FOR_DELIVERY" ? <ConfirmReceivedButton orderId={order.id}/> : null}
      {order.paymentStatus === "FAILED" && order.status !== "CANCELLED" ? <OrderRecoveryActions orderId={order.id} phone={order.phone} items={items.map((item) => ({ productId: item.productId, quantity: item.quantity }))} mpesaEnabled={data.payment.mpesaEnabled} /> : null}
    </section>
  </main>;
}
