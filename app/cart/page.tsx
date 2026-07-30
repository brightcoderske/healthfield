import { CartView } from "./cart-view";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { cookies } from "next/headers";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";

export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const catalog = await getDb().select({
    id: products.id,
    name: products.name,
    price: products.price,
    discountPrice: products.discountPrice,
    imageUrl: products.imageUrl,
    packSize: products.packSize,
  }).from(products).where(eq(products.isActive, true));
  const addProductId = Number((await searchParams).add);
  const jar = await cookies();
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  if (Number.isInteger(addProductId) && addProductId > 0) initialCart[addProductId] = (initialCart[addProductId] || 0) + 1;
  return <CartView initialCatalog={catalog} initialCart={initialCart} />;
}
