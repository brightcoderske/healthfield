import Image from "next/image";
import { PrintReceiptButton } from "@/app/admin/receipts/orders/[id]/print-button";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

type Data={order:{id:number;orderNumber:string;customerName:string;phone:string;email:string|null;fulfilmentMethod:string;paymentStatus:string;status:string;subtotal:string;deliveryFee:string;discount:string;total:string;createdAt:string};items:Array<{productName:string;quantity:number;unitPrice:string;lineTotal:string}>};

export default async function StaffReceipt({params}:{params:Promise<{id:string}>}){
  await requireStaffPermission("RECEIPTS_VIEW");
  const data=await backendJson<Data>(`/v1/views/staff/receipts/orders/${(await params).id}`),{order,items}=data;
  return <main className="print-receipt"><header><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={230} height={82}/><div><span>Official receipt</span><h1>{order.orderNumber}</h1><small>{new Date(order.createdAt).toLocaleString("en-KE")}</small></div></header><section><div><small>Customer</small><strong>{order.customerName}</strong><span>{order.phone}</span>{order.email&&<span>{order.email}</span>}</div><div><small>Order</small><strong>{order.fulfilmentMethod}</strong><span>{order.paymentStatus} · {order.status.replaceAll("_"," ")}</span></div></section><table><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{items.map((item,index)=><tr key={index}><td>{item.productName}</td><td>{item.quantity}</td><td>KES {Number(item.unitPrice).toLocaleString()}</td><td>KES {Number(item.lineTotal).toLocaleString()}</td></tr>)}</tbody></table><aside><span>Subtotal <b>KES {Number(order.subtotal).toLocaleString()}</b></span><span>Delivery <b>KES {Number(order.deliveryFee).toLocaleString()}</b></span>{Number(order.discount)>0&&<span>Discount <b>- KES {Number(order.discount).toLocaleString()}</b></span>}<strong>Total <b>KES {Number(order.total).toLocaleString()}</b></strong></aside><footer><p>Thank you for choosing Healthfield Pharmacy.</p><small>Genuine products · Professional pharmacy support</small></footer><PrintReceiptButton orderId={order.id} basePath="/staff/receipts/orders"/></main>;
}
