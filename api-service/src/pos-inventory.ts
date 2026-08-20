import { and, asc, eq, sql } from "drizzle-orm";
import { productBatches } from "../../db/schema";
import { getDb } from "./db";

type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Consume tracked supplier batches in first-expiry-first-out order.
 * Legacy stock may have no batch rows, so an exhausted batch ledger never blocks a
 * sale; branch_inventory remains the authoritative total and batch reporting consumes
 * only the quantity it can trace.
 */
export async function consumePosBatches(tx: DatabaseTransaction, branchId: number, productId: number, quantity: number) {
  let remaining = quantity;
  const batches = await tx.select().from(productBatches).where(and(eq(productBatches.branchId, branchId), eq(productBatches.productId, productId), sql`${productBatches.quantityRemaining} > 0`)).orderBy(sql`${productBatches.expiryDate} is null`, asc(productBatches.expiryDate), asc(productBatches.createdAt)).for("update");
  for (const batch of batches) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, batch.quantityRemaining);
    await tx.update(productBatches).set({ quantityRemaining: batch.quantityRemaining - consumed }).where(eq(productBatches.id, batch.id));
    remaining -= consumed;
  }
  return { traced: quantity - remaining, untraced: remaining };
}
