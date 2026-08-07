import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { CART_COOKIE,parseCart } from "@/lib/shopping-state";
import { CheckoutForm } from "./checkout-form";
export const metadata={title:"Checkout"};export const dynamic="force-dynamic";
type Data={catalog:Array<{id:number;name:string;price:string;discountPrice:string|null;packSize:string|null}>;customer:{firstName:string;lastName:string;email:string;phone:string|null}|null;payment:{onlineMpesaEnabled:boolean;onlineManualEnabled:boolean;tillNumber:string|null;accountName:string|null}};
export default async function CheckoutPage(){const cart=parseCart((await cookies()).get(CART_COOKIE)?.value),ids=Object.keys(cart).join(","),data=await backendJson<Data>(`/v1/views/checkout?ids=${encodeURIComponent(ids)}`);return <CheckoutForm initialCart={cart} initialCatalog={data.catalog} customer={data.customer} payment={data.payment}/>}
