import { Storefront } from "./storefront";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, products } from "@/db/schema";
import { healthConditions, productHealthConditions, productReviews, siteSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { cookies } from "next/headers";
import { CART_COOKIE, parseCart, parseWishlist, WISHLIST_COOKIE } from "@/lib/shopping-state";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ offers?: string }> }) {
  let catalog: Array<{
    id: number;
    name: string;
    price: number;
    imageUrl: string | null;
    packSize: string | null;
    brand: string | null;
    categoryId: number;
    shortDescription: string | null;
    conditionIds: number[];
    rating: number | null;
    reviewCount: number;
    discountPrice: number | null;
  }> = [];
  let contact = { phone: "", whatsapp: "", deliveryMessage: "Fast Delivery Across Kenya" };
  let categoryRows: Array<{ id: number; name: string; slug: string }> = [];
  let conditionRows: Array<{ id: number; name: string; slug: string }> = [];
  try {
    const db = getDb();
    const rows = await db.select({
      id: products.id,
      name: products.name,
      price: products.price,
      imageUrl: products.imageUrl,
      packSize: products.packSize,
      brand: products.brand,
      categoryId: products.categoryId,
      shortDescription: products.shortDescription,
      discountPrice: products.discountPrice,
      rating: sql<string | null>`avg(case when ${productReviews.isApproved} = true then ${productReviews.rating} end)`,
      reviewCount: sql<number>`count(case when ${productReviews.isApproved} = true then 1 end)`,
    }).from(products)
      .leftJoin(productReviews, eq(productReviews.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.id)
      .orderBy(desc(products.isFeatured), desc(products.createdAt))
      .limit(50);
    const mappings = await db.select().from(productHealthConditions);
    catalog = rows.map((row) => ({
      ...row,
      price: Number(row.price),
      discountPrice: row.discountPrice === null ? null : Number(row.discountPrice),
      rating: row.rating === null ? null : Number(row.rating),
      reviewCount: Number(row.reviewCount),
      conditionIds: mappings.filter((mapping) => mapping.productId === row.id).map((mapping) => mapping.conditionId),
    }));
    const [settings] = await db.select().from(siteSettings).limit(1);
    if (settings) contact = {
      phone: settings.phone ?? "",
      whatsapp: settings.whatsapp ?? "",
      deliveryMessage: settings.deliveryMessage,
    };
    categoryRows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories).where(eq(categories.isActive, true)).orderBy(categories.displayOrder);
    conditionRows = await db.select({ id: healthConditions.id, name: healthConditions.name, slug: healthConditions.slug })
      .from(healthConditions).where(eq(healthConditions.isActive, true)).orderBy(healthConditions.displayOrder);
  } catch {
    // The storefront still renders during first-time setup before migrations run.
  }
  const session = await getSession();
  const jar = await cookies();
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  const initialWishlist = parseWishlist(jar.get(WISHLIST_COOKIE)?.value);
  const offersOnly = (await searchParams).offers === "1";
  return <Storefront initialProducts={catalog} initialCategories={categoryRows} initialConditions={conditionRows} contact={contact} viewer={session ? { firstName: session.firstName, role: session.role } : null} offersOnly={offersOnly} initialCart={initialCart} initialWishlist={initialWishlist} />;
}
