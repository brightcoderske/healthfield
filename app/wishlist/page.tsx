import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { parseWishlist,WISHLIST_COOKIE } from "@/lib/shopping-state";
import { WishlistView } from "./wishlist-view";
export const dynamic="force-dynamic";
type Product={id:number;name:string;price:string;discountPrice:string|null;imageUrl:string|null};
export default async function WishlistPage(){const ids=parseWishlist((await cookies()).get(WISHLIST_COOKIE)?.value);const data=ids.length?await backendJson<{products:Product[]}>(`/v1/views/catalogue?ids=${ids.join(",")}`):{products:[]};return <WishlistView items={data.products}/>}
