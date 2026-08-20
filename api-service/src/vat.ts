import { and, desc, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLogs, branches, orders, vatRemittances } from "../../db/schema";
import { getDb } from "./db";
import { json } from "./http";
import { requireSession } from "./auth";

/**
 * VAT owed to KRA is the tax charged since the last remittance, not a figure for the
 * dashboard's date range. Remitting records what was handed over and moves the window
 * forward, which is what returns the running total to zero without touching the orders
 * the tax came from.
 */
export async function vatBalance() {
  const db = getDb();
  const [last] = await db
    .select({ periodTo: vatRemittances.periodTo })
    .from(vatRemittances)
    .orderBy(desc(vatRemittances.periodTo))
    .limit(1);
  const since = last?.periodTo ?? new Date(0);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      channel: orders.posSessionId,
      subtotal: orders.subtotal,
      vat: orders.vat,
      vatRate: orders.vatRate,
      total: orders.total,
      branch: branches.name,
      createdAtUnix: sql<number>`unix_timestamp(${orders.createdAt})`,
    })
    .from(orders)
    .leftJoin(branches, sql`${branches.id} = ${orders.suggestedBranchId}`)
    .where(and(gt(orders.vat, "0"), gt(orders.createdAt, since), ne(orders.status, "CANCELLED")))
    .orderBy(desc(orders.createdAt))
    .limit(500);
  return {
    since: since.toISOString(),
    collected: Math.round(rows.reduce((sum, row) => sum + Number(row.vat), 0) * 100) / 100,
    orderCount: rows.length,
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      source: row.channel ? "POS" : "Online",
      subtotal: Number(row.subtotal),
      vat: Number(row.vat),
      vatRate: Number(row.vatRate),
      total: Number(row.total),
      branch: row.branch,
      createdAt: new Date(Number(row.createdAtUnix) * 1000).toISOString(),
    })),
  };
}

export async function handleVatRemittances(request: Request) {
  const auth = await requireSession(request, ["ADMIN", "SUPER_ADMIN"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const parsed = z
    .object({ note: z.string().trim().max(300).optional() })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "The remittance note is too long." }, { status: 400 });
  const balance = await vatBalance();
  if (balance.collected <= 0) return json({ error: "There is no VAT to remit yet." }, { status: 409 });
  const db = getDb();
  // The window closes at the newest order counted, never at "now", so a sale made while
  // this was being recorded is carried into the next period instead of disappearing.
  const periodTo = new Date(balance.orders[0]!.createdAt);
  const [created] = await db.insert(vatRemittances).values({
    amount: balance.collected.toFixed(2),
    orderCount: balance.orderCount,
    periodFrom: new Date(balance.since),
    periodTo,
    note: parsed.data.note || null,
    remittedBy: auth.session.userId,
  });
  await db.insert(activityLogs).values({
    actorId: auth.session.userId,
    action: "VAT_REMITTED",
    entityType: "vat_remittance",
    entityId: String(created.insertId),
    metadata: { amount: balance.collected, orderCount: balance.orderCount, periodFrom: balance.since, periodTo: periodTo.toISOString() },
  });
  return json({ ok: true, id: created.insertId, amount: balance.collected, orderCount: balance.orderCount }, { status: 201 });
}
