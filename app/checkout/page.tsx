import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { CART_COOKIE, parseCart, parseCartOffers } from "@/lib/shopping-state";
import { CheckoutForm, type CheckoutOffer } from "./checkout-form";
export const metadata={title:"Checkout"};export const dynamic="force-dynamic";
type Data={catalog:Array<{id:number;name:string;price:string;discountPrice:string|null;packSize:string|null}>;offers?:CheckoutOffer[];customer:{firstName:string;lastName:string;email:string;phone:string|null}|null;payment:{onlineMpesaEnabled:boolean;onlineManualEnabled:boolean;tillNumber:string|null;accountName:string|null}};
export default async function CheckoutPage(){
  const jar=await cookies();
  const cart=parseCart(jar.get(CART_COOKIE)?.value);
  const offerIds=Object.keys(parseCartOffers(jar.get(CART_COOKIE)?.value)).map(Number);
  const ids=Object.keys(cart).join(",");
  const data=await backendJson<Data>(`/v1/views/checkout?ids=${encodeURIComponent(ids)}`);
  // Only bundles still live are carried into checkout; an expired one silently drops.
  const offers=(data.offers||[]).filter((offer)=>offerIds.includes(offer.id));
  return <CheckoutForm initialCart={cart} initialCatalog={data.catalog} initialOffers={offers} customer={data.customer} payment={data.payment}/>
}
