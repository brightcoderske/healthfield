import { AlertTriangle, Check, Circle, FileText, LockKeyhole, MessageCircle, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { prescriptionStatuses, prescriptionStatusLabels, prescriptionTrackingSteps, type PrescriptionStatus } from "@/lib/prescription-workflow";
import { requireRole } from "@/lib/auth";
import { DispenseSelector } from "./dispense-selector";
import type { CustomerPrescriptionData } from "../types";

export const dynamic = "force-dynamic";

function label(status:string){return prescriptionStatuses.includes(status as PrescriptionStatus)?prescriptionStatusLabels[status as PrescriptionStatus]:status.replaceAll("_"," ")}

export default async function CustomerPrescriptionPage({params}:{params:Promise<{id:string}>}){
  await requireRole(["CUSTOMER"]);
  const id=Number((await params).id);
  let data:CustomerPrescriptionData;
  try{data=await backendJson<CustomerPrescriptionData>(`/v1/views/account/prescriptions/${id}`)}catch(error){if(error instanceof BackendError&&error.status===404)notFound();throw error}
  const {request,items,order}=data;
  const steps=prescriptionTrackingSteps({prescriptionStatus:request.status,orderStatus:order?.status,paymentStatus:order?.paymentStatus});
  const proposalItems=items.filter((item)=>item.availability!=="UNAVAILABLE"&&item.approvedQuantity&&item.unitPrice);
  const canPay=request.status==="APPROVED"&&order?.status==="AWAITING_PAYMENT"&&order.paymentStatus!=="PAID";
  const paid=order?.paymentStatus==="PAID";
  return <main className="prescription-customer-page">
    <header><Link href="/account#prescriptions">← My prescriptions</Link><Link href="/#products"><ShoppingBag/> Continue shopping</Link></header>
    <section className="prescription-customer-hero"><div><span className={`prescription-customer-status ${request.status.toLowerCase().replaceAll("_","-")}`}>{label(request.status)}</span><h1>Prescription request #{request.id}</h1><p>Uploaded {new Date(request.createdAt).toLocaleString("en-KE")}</p></div><a href={`/api/prescriptions/${request.id}/download`} target="_blank" rel="noreferrer"><FileText/> View prescription</a></section>
    {request.status==="MORE_INFORMATION_REQUIRED"?<section className="prescription-customer-alert"><AlertTriangle/><div><strong>Your pharmacist needs more information</strong><p>{request.pharmacistNotes||"Please contact the pharmacy team so the review can continue."}</p></div><Link href="/chat"><MessageCircle/> Reply in chat</Link></section>:null}
    <section className="prescription-tracker"><header><div><small>Live progress</small><h2>Prescription journey</h2></div><span>{label(request.status)}</span></header><ol>{steps.map((step)=><li key={step.key} className={step.state}><i>{step.state==="complete"?<Check/>:step.state==="attention"?<AlertTriangle/>:<Circle/>}</i><span><strong>{step.label}</strong><small>{step.state==="complete"?"Completed":step.state==="current"?"Current stage":step.state==="attention"?"Your attention is needed":"Upcoming"}</small></span></li>)}</ol></section>
    <div className="prescription-customer-grid">
      <section className="prescription-saved-proposal"><header><div><LockKeyhole/><span><small>Pharmacy prepared</small><h2>{order?"Your saved proposal":"Medicine review"}</h2></span></div>{order?<b>{order.orderNumber}</b>:null}</header>
        {proposalItems.length?<div className="prescription-proposal-lines">{proposalItems.map((item)=><article key={item.id}><span><strong>{item.productName}</strong><small>Quantity {item.approvedQuantity} · KES {Number(item.unitPrice).toLocaleString()} each{item.pharmacistNote?` · ${item.pharmacistNote}`:""}</small></span><b>KES {(Number(item.unitPrice)*Number(item.approvedQuantity)).toLocaleString()}</b></article>)}</div>:<div className="prescription-proposal-pending"><FileText/><strong>{request.status==="DECLINED"?"No proposal was created":"Your pharmacist is preparing the medicine list"}</strong><p>{request.status==="DECLINED"?(request.pharmacistNotes||"Contact the pharmacy if you need help."):"Confirmed medicines, quantities and prices will appear here after approval."}</p></div>}
        {canPay&&proposalItems.length>1?<DispenseSelector prescriptionId={request.id} items={proposalItems}/>:null}
        {order?<footer><span><small>{paid?"Paid total":"Proposal total"}</small><strong>KES {Number(order.total).toLocaleString()}</strong></span>{canPay?<Link href={`/account/prescriptions/${request.id}/checkout`}>Review &amp; pay</Link>:paid?<Link href={`/account/orders/${order.id}`}>View paid order</Link>:null}</footer>:null}
      </section>
      <aside className="prescription-cart-independence"><ShoppingBag/><h2>Your normal cart stays separate</h2><p>You can ignore this saved proposal for now, keep adding any other products to your normal cart, and return here whenever you are ready.</p><div><Link href="/#products">Keep shopping</Link>{canPay?<Link href={`/account/prescriptions/${request.id}/checkout`}>Return to proposal</Link>:null}</div></aside>
    </div>
  </main>;
}
