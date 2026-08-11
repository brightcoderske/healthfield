import { FileText, Package, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";

export const dynamic="force-dynamic";
type Detail={customer:{id:number;firstName:string;lastName:string;email:string;phone:string|null;isActive:boolean;emailVerifiedAt:string|null;createdAt:string};orders:Array<{id:number;orderNumber:string;status:string;paymentStatus:string;paymentMethod:string;total:string;createdAt:string}>;prescriptions:Array<{id:number;orderId:number|null;originalFilename:string;status:string;pharmacistNotes:string|null;createdAt:string}>};

export default async function CustomerDetailPage({params}:{params:Promise<{id:string}>}){
  const id=Number((await params).id);let data:Detail;
  try{data=await backendJson<Detail>(`/v1/views/admin/customers/${id}`)}catch(error){if(error instanceof BackendError&&error.status===404)notFound();throw error}
  const {customer,orders,prescriptions}=data;
  return <main className="data-page customer-history-page"><header><Link href="/admin/customers">← Customers</Link><span>Customer profile</span><h1>{customer.firstName} {customer.lastName}</h1></header>
    <section className="customer-profile-summary"><UserRound/><div><strong>{customer.email}</strong><span>{customer.phone||"No phone number"}</span><small>Joined {new Date(customer.createdAt).toLocaleDateString("en-KE")} · {customer.emailVerifiedAt?"Email verified":"Email not verified"} · {customer.isActive?"Active":"Suspended"}</small></div></section>
    <section className="customer-history-section"><header><div><Package/><span><strong>Orders</strong><small>{orders.length} total</small></span></div></header><div className="customer-history-table"><div className="history-head"><span>Order</span><span>Status</span><span>Payment</span><span>Total</span><span>Date</span></div>{orders.length?orders.map(order=><Link href={`/admin/orders/${order.id}`} key={order.id}><strong className="history-link">{order.orderNumber}</strong><span>{order.status.replaceAll("_"," ")}</span><span>{order.paymentStatus} · {order.paymentMethod.replaceAll("_"," ")}</span><b>KES {Number(order.total).toLocaleString()}</b><time>{new Date(order.createdAt).toLocaleDateString("en-KE")}</time></Link>):<p className="history-empty">No orders recorded for this customer.</p>}</div></section>
    <section className="customer-history-section"><header><div><FileText/><span><strong>Prescriptions</strong><small>{prescriptions.length} total</small></span></div></header><div className="customer-history-table prescriptions-history"><div className="history-head"><span>File</span><span>Status</span><span>Order</span><span>Notes</span><span>Date</span></div>{prescriptions.length?prescriptions.map(item=><article key={item.id}><a className="history-link" href={`/api/prescriptions/${item.id}/download`} target="_blank" rel="noreferrer" title={`Open ${item.originalFilename}`}>{item.originalFilename}</a><span>{item.status.replaceAll("_"," ")}</span><span>{item.orderId?<Link className="history-link" href={`/admin/orders/${item.orderId}`}>Order #{item.orderId}</Link>:"Not linked"}</span><span>{item.pharmacistNotes||"No notes"}</span><time>{new Date(item.createdAt).toLocaleDateString("en-KE")}</time></article>):<p className="history-empty">No prescriptions recorded for this customer.</p>}</div></section>
  </main>
}
