import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, healthConditions, productHealthConditions, products } from "@/db/schema";
import { ProductManager } from "./product-manager";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const db = getDb();
  const [catalog, categoryRows, conditions, mappings] = await Promise.all([
    db.select().from(products).orderBy(desc(products.createdAt)),
    db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.displayOrder)),
    db.select().from(healthConditions).where(eq(healthConditions.isActive, true)).orderBy(asc(healthConditions.displayOrder)),
    db.select().from(productHealthConditions),
  ]);
  return <ProductManager initialProducts={catalog.map((product) => ({ ...product, price: Number(product.price), discountPrice: product.discountPrice ? Number(product.discountPrice) : null, conditionIds: mappings.filter((mapping) => mapping.productId === product.id).map((mapping) => mapping.conditionId) }))} categories={categoryRows} conditions={conditions} />;
}
