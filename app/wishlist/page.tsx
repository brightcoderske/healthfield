import { inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { parseWishlist, WISHLIST_COOKIE } from "@/lib/shopping-state";
import { WishlistView } from "./wishlist-view";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const ids = parseWishlist((await cookies()).get(WISHLIST_COOKIE)?.value);
  const items = ids.length ? await getDb().select({
    id: products.id,
    name: products.name,
    price: products.price,
    discountPrice: products.discountPrice,
    imageUrl: products.imageUrl,
  }).from(products).where(inArray(products.id, ids)) : [];
  return <WishlistView items={items} />;
}
