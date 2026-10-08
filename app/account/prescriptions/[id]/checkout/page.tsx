import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { CART_COOKIE, parseCart, parseCartOffers } from "@/lib/shopping-state";
import { PrescriptionCheckoutForm, type CartExtras } from "./prescription-checkout-form";
import type { CustomerPrescriptionData } from "../../types";

export const dynamic="force-dynamic";
export const metadata={title:"Prescription checkout"};

type CartView={
  catalog:Array<{id:number;name:string;price:string;discountPrice:string|null;prescriptionRequired:boolean}>;
  offers?:Array<{id:number;title:string;total:number;items:Array<{productId:number;quantity:number;prescriptionRequired:boolean}>}>;
};

export default async function PrescriptionCheckoutPage({params}:{params:Promise<{id:string}>}){
  await requireRole(["CUSTOMER"]);
  const id=Number((await params).id);
  const data=await backendJson<CustomerPrescriptionData>(`/v1/views/account/prescriptions/${id}`);
  if(data.request.status!=="APPROVED"||!data.order||data.order.status!=="AWAITING_PAYMENT"||data.order.paymentStatus==="PAID")redirect(`/account/prescriptions/${id}`);
  // Whatever is in the customer's own cart is paid for together with the prescription.
  const jar=await cookies();
  const cart=parseCart(jar.get(CART_COOKIE)?.value);
  const offerIds=Object.keys(parseCartOffers(jar.get(CART_COOKIE)?.value)).map(Number);
  const view=Object.keys(cart).length||offerIds.length?await backendJson<CartView>(`/v1/views/checkout?ids=${encodeURIComponent(Object.keys(cart).join(","))}`).catch(()=>null):null;
  // Prescription medicines cannot ride in a cart; they are named so the customer knows why.
  const inCart=(view?.catalog||[]).filter((product)=>cart[product.id]);
  const liveOffers=(view?.offers||[]).filter((offer)=>offerIds.includes(offer.id));
  const extras:CartExtras={
    products:inCart.filter((product)=>!product.prescriptionRequired).map((product)=>({id:product.id,name:product.name,price:Number(product.discountPrice??product.price),quantity:cart[product.id]})),
    offers:liveOffers.filter((offer)=>!offer.items.some((item)=>item.prescriptionRequired)).map((offer)=>({id:offer.id,title:offer.title,total:Number(offer.total),items:offer.items.map((item)=>({productId:item.productId,quantity:item.quantity}))})),
    heldBack:[...inCart.filter((product)=>product.prescriptionRequired).map((product)=>product.name),...liveOffers.filter((offer)=>offer.items.some((item)=>item.prescriptionRequired)).map((offer)=>offer.title)],
  };
  return <PrescriptionCheckoutForm prescriptionId={id} data={data} extras={extras}/>;
}
