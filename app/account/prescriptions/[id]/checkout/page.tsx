import { redirect } from "next/navigation";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { PrescriptionCheckoutForm } from "./prescription-checkout-form";
import type { CustomerPrescriptionData } from "../../types";

export const dynamic="force-dynamic";
export const metadata={title:"Prescription checkout"};

export default async function PrescriptionCheckoutPage({params}:{params:Promise<{id:string}>}){
  await requireRole(["CUSTOMER"]);
  const id=Number((await params).id);
  const data=await backendJson<CustomerPrescriptionData>(`/v1/views/account/prescriptions/${id}`);
  if(data.request.status!=="APPROVED"||!data.order||data.order.status!=="AWAITING_PAYMENT"||data.order.paymentStatus==="PAID")redirect(`/account/prescriptions/${id}`);
  return <PrescriptionCheckoutForm prescriptionId={id} data={data}/>;
}
