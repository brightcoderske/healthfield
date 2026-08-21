import { backendJson } from "@/lib/backend-api";
import { TaxonomyManager } from "./taxonomy-manager";
export const dynamic = "force-dynamic";

type CategoryRow = { id: number; name: string; description?: string | null; parentId?: number | null; featuredOnStorefront?: boolean };
type ConditionRow = { id: number; name: string; description?: string | null };
type ProductRow = { categoryId: number; conditionIds?: number[]; isActive?: boolean };

export default async function TaxonomyPage() {
  const data = await backendJson<{ products: ProductRow[]; categories: CategoryRow[]; conditions: ConditionRow[] }>("/v1/views/admin/products");
  // Counted here rather than in the API: this screen already receives the catalogue,
  // and a category is only safe to move once you can see how much moves with it.
  const productCounts: Record<number, number> = {};
  const conditionCounts: Record<number, number> = {};
  for (const product of data.products) {
    productCounts[product.categoryId] = (productCounts[product.categoryId] || 0) + 1;
    for (const conditionId of product.conditionIds || []) conditionCounts[conditionId] = (conditionCounts[conditionId] || 0) + 1;
  }
  return <TaxonomyManager
    initialCategories={data.categories}
    initialConditions={data.conditions}
    productCounts={productCounts}
    conditionCounts={conditionCounts}
  />;
}
