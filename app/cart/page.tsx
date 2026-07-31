import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { CartView } from "./cart-view";
export const dynamic="force-dynamic";
type Product={id:number;name:string;price:string;discountPrice:string|null;imageUrl:string|null;packSize:string|null};
export default async function CartPage({searchParams}:{searchParams:Promise<{add?:string}>}){const initialCart=parseCart((await cookies()).get(CART_COOKIE)?.value),addProductId=Number((await searchParams).add);if(Number.isInteger(addProductId)&&addProductId>0)initialCart[addProductId]=(initialCart[addProductId]||0)+1;const ids=Object.keys(initialCart).join(","),data=await backendJson<{products:Product[]}>(`/v1/views/catalogue?ids=${encodeURIComponent(ids)}`);return <CartView initialCatalog={data.products} initialCart={initialCart}/>}
