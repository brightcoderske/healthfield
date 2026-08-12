/* eslint-disable @next/next/no-img-element */
import { FileText, Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { prescriptionStatuses, prescriptionStatusLabels, type PrescriptionStatus } from "@/lib/prescription-workflow";

export const dynamic="force-dynamic";

type Data={
  orders:Array<{id:number;orderNumber:string;createdAt:string;fulfilmentMethod:string;status:string;total:string}>;
  catalog:Array<{id:number;name:string;imageUrl:string|null;packSize:string|null;price:string;discountPrice:string|null}>;
  prescriptions:Array<{id:number;originalFilename:string;status:string;pharmacistNotes:string|null;createdAt:string;orderStatus:string|null;paymentStatus:string|null;orderTotal:string|null;items:Array<{id:number}>}>;
};

function prescriptionLabel(status:string){return prescriptionStatuses.includes(status as PrescriptionStatus)?prescriptionStatusLabels[status as PrescriptionStatus]:status.replaceAll("_"," ")}

export default async function AccountPage(){
  const user=await requireRole(["CUSTOMER"]),data=await backendJson<Partial<Data>>("/v1/views/account"),orders=data.orders||[],rx=data.prescriptions||[],catalog=data.catalog||[];
  return <main className="customer-account compact-account">
    <header><Link href="/#products">← Continue shopping</Link><form action="/api/auth/logout" method="post"><button>Sign out</button></form></header>
    <div className="account-welcome"><span>My Healthfield</span><h1>Hello, {user.firstName}</h1><p>Shop, track orders, prescriptions and pharmacy support.</p></div>
    <section className="account-orders account-table" id="orders"><div><h2>My orders</h2><Link href="/#products">Shop more</Link></div><header><span>Order</span><span>Status</span><span>Amount</span></header>{orders.length?orders.map((order)=><Link href={`/account/orders/${order.id}`} key={order.id}><span><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("en-KE")} · {order.fulfilmentMethod}</small></span><em>{order.status.replaceAll("_"," ")}</em><b>KES {Number(order.total).toLocaleString()}</b></Link>):<div className="account-empty"><Package/><span><strong>No orders yet</strong><small>Your first paid order will appear here.</small></span></div>}</section>
    <section className="account-orders account-table account-prescriptions" id="prescriptions"><div><h2>My prescriptions</h2><Link href="/prescriptions/upload">Upload another</Link></div><header><span>Prescription</span><span>Current stage</span><span>Proposal</span></header>{rx.length?rx.map((request)=><Link href={`/account/prescriptions/${request.id}`} key={request.id}><span><strong>{request.originalFilename}</strong><small>{request.status==="APPROVED"&&request.orderStatus==="AWAITING_PAYMENT"?"Saved proposal ready · return whenever you choose":request.pharmacistNotes||`${request.items.length} linked ${request.items.length===1?"item":"items"}`}</small></span><em className={`rx-${request.status.toLowerCase().replaceAll("_","-")}`}>{prescriptionLabel(request.status)}</em><b>{request.orderTotal?`KES ${Number(request.orderTotal).toLocaleString()}`:new Date(request.createdAt).toLocaleDateString("en-KE")}</b></Link>):<div className="account-empty"><FileText/><span><strong>No prescriptions uploaded</strong><small>Review progress and saved proposals will appear here.</small></span></div>}</section>
    <section className="account-products"><header><div><h2>Continue shopping</h2><p>Your normal cart remains independent from pharmacy proposals.</p></div><Link href="/#products">View all</Link></header><div>{catalog.map((product)=><article key={product.id}><Link href={`/products/${product.id}`}><div>{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</div><strong>{product.name}</strong><small>{product.packSize||"Healthfield Pharmacy"}</small></Link><footer><b>KES {Number(product.discountPrice??product.price).toLocaleString()}</b><form action="/api/cart" method="post"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="action" value="add"/><input type="hidden" name="return" value="/account"/><button aria-label={`Add ${product.name} to cart`}><ShoppingCart/></button></form></footer></article>)}</div></section>
  </main>;
}
