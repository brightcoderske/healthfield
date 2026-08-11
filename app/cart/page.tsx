import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { CART_COOKIE, parseCart, parseCartOffers } from "@/lib/shopping-state";
import { CartView, type CartOffer } from "./cart-view";
export const dynamic = "force-dynamic";
type Product = { id:number; name:string; price:string; discountPrice:string|null; imageUrl:string|null; packSize:string|null };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const jar = await cookies();
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  const offerIds = Object.keys(parseCartOffers(jar.get(CART_COOKIE)?.value)).map(Number);
  const addProductId = Number((await searchParams).add);
  if (Number.isInteger(addProductId) && addProductId > 0) initialCart[addProductId] = (initialCart[addProductId] || 0) + 1;
  const ids = Object.keys(initialCart).join(",");
  const data = await backendJson<{ products: Product[]; offers?: CartOffer[] }>(`/v1/views/catalogue?ids=${encodeURIComponent(ids)}`);
  // Bundles are resolved live, so one that ended simply stops appearing in the cart.
  const offers = (data.offers || []).filter((offer) => offerIds.includes(offer.id));
  return <CartView initialCatalog={data.products} initialCart={initialCart} initialOffers={offers}/>;
}
