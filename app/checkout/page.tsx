import { eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { products, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { CheckoutForm } from "./checkout-form";
export const metadata={title:"Checkout"};
export const dynamic="force-dynamic";
export default async function CheckoutPage(){const db=getDb(),session=await getSession(),cart=parseCart((await cookies()).get(CART_COOKIE)?.value),ids=Object.keys(cart).map(Number);const catalog=ids.length?await db.select({id:products.id,name:products.name,price:products.price,discountPrice:products.discountPrice,packSize:products.packSize}).from(products).where(inArray(products.id,ids)):[];const customer=session?.role==="CUSTOMER"?(await db.select({firstName:users.firstName,lastName:users.lastName,email:users.email,phone:users.phone}).from(users).where(eq(users.id,session.userId)).limit(1))[0]??null:null;return <CheckoutForm initialCart={cart} initialCatalog={catalog} customer={customer}/>}
