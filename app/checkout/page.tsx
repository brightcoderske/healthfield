import { inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { CheckoutForm } from "./checkout-form";
export const metadata={title:"Checkout"};
export const dynamic="force-dynamic";
export default async function CheckoutPage(){const cart=parseCart((await cookies()).get(CART_COOKIE)?.value),ids=Object.keys(cart).map(Number);const catalog=ids.length?await getDb().select({id:products.id,name:products.name,price:products.price,discountPrice:products.discountPrice,packSize:products.packSize}).from(products).where(inArray(products.id,ids)):[];return <CheckoutForm initialCart={cart} initialCatalog={catalog}/>}
