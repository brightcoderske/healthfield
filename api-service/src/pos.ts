import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activityLogs, branches, branchInventory, orderItems, orders, paymentTransactions,
  posExpenses, posHeldSales, posSessions, posStockReceiptItems, posStockReceipts, posSuppliers,
  posTills, productBatches, products, siteSettings, users,
} from "../../db/schema";
import { expectedSessionCash, nairobiDateTime, sessionCashDifference } from "../../lib/pos";
import { summariseProfit } from "../../lib/profit";
import { getDb } from "./db";
import { sendEmail } from "./email";
import { json, publicImageUrl, safeFilename } from "./http";
import { mpesaConfiguration } from "./mpesa";
import { renderPosSessionReport, type PosSessionReportData } from "./pos-session-report";
import { storageRoot, validatePrescriptionUpload } from "./prescription-files";
import { sendSms } from "./sms";
import { requireTeamPermission } from "./staff-permissions";

const moneySchema = z.coerce.number().finite().nonnegative().max(100_000_000);
const cartSchema = z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(999) })).min(1).max(250);
const expirySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

type PosAuth = Awaited<ReturnType<typeof requireTeamPermission>>;

function isAuthResponse(auth: PosAuth): auth is Extract<PosAuth, { response: Response }> {
  return "response" in auth;
}

function sessionNumber(branchCode: string) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  return `PS-${branchCode}-${stamp}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function receiptNumber(branchCode: string) {
  return `GRN-${branchCode}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

async function actorOpenSession(sessionId: number, userId: number) {
  const [session] = await getDb().select().from(posSessions).where(and(eq(posSessions.id, sessionId), eq(posSessions.userId, userId), eq(posSessions.status, "OPEN"))).limit(1);
  return session ?? null;
}

/** Current persisted state needed by the cashier workspace. */
export async function posWorkspaceState(request: Request) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  if (auth.session.role === "STAFF" && !auth.session.homeBranchId) return json({ error: "This staff account is not assigned to a shop." }, { status: 409 });
  const db = getDb();
  const branchCondition = auth.session.role === "STAFF" ? eq(branches.id, auth.session.homeBranchId!) : eq(branches.isActive, true);
  const stockCondition = auth.session.role === "STAFF" ? eq(branchInventory.branchId, auth.session.homeBranchId!) : undefined;
  const [branchRows, tillRows, productRows, stockRows, sessions, settingsRows, cashierRows, supplierRows] = await Promise.all([
    db.select({ id: branches.id, name: branches.name, code: branches.code }).from(branches).where(and(eq(branches.isActive, true), branchCondition)).orderBy(asc(branches.name)),
    db.select({ id: posTills.id, branchId: posTills.branchId, name: posTills.name, code: posTills.code, mpesaTillNumber: posTills.mpesaTillNumber }).from(posTills).where(eq(posTills.isActive, true)).orderBy(asc(posTills.name)),
    db.select({ id: products.id, name: products.name, sku: products.sku, barcode: products.barcode, brand: products.brand, packSize: products.packSize, imageUrl: products.imageUrl, price: products.price, discountPrice: products.discountPrice }).from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)),
    db.select({ branchId: branchInventory.branchId, productId: branchInventory.productId, available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`, reorderLevel: branchInventory.reorderLevel }).from(branchInventory).where(stockCondition),
    db.select({
      id: posSessions.id, sessionNumber: posSessions.sessionNumber, branchId: posSessions.branchId, tillId: posSessions.tillId,
      openingFloat: posSessions.openingFloat, openingCash: posSessions.openingCash,
      openedAtUnix: sql<number>`unix_timestamp(${posSessions.openedAt})`, branchName: branches.name, tillName: posTills.name,
    }).from(posSessions).innerJoin(branches, eq(branches.id, posSessions.branchId)).innerJoin(posTills, eq(posTills.id, posSessions.tillId))
      .where(and(eq(posSessions.userId, auth.session.userId), eq(posSessions.status, "OPEN"))).orderBy(desc(posSessions.openedAt)).limit(1),
    db.select({ posCashEnabled: siteSettings.posCashEnabled, posMpesaEnabled: siteSettings.posMpesaEnabled, posManualEnabled: siteSettings.posManualEnabled, mpesaTillNumber: siteSettings.mpesaTillNumber, mpesaAccountName: siteSettings.mpesaAccountName, vatEnabled: siteSettings.vatEnabled, vatRate: siteSettings.vatRate }).from(siteSettings).limit(1),
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role, branchId: users.homeBranchId }).from(users).where(and(inArray(users.role, ["STAFF", "ADMIN", "SUPER_ADMIN"]), eq(users.isActive, true))).orderBy(asc(users.firstName), asc(users.lastName)),
    db.select({ id: posSuppliers.id, name: posSuppliers.name, phone: posSuppliers.phone, lastReceivedAtUnix: sql<number | null>`unix_timestamp(${posSuppliers.lastReceivedAt})` }).from(posSuppliers).orderBy(asc(posSuppliers.name)),
  ]);
  const active = sessions[0] ?? null;
  const [held, expenses, totals] = active ? await Promise.all([
    db.select({ id: posHeldSales.id, label: posHeldSales.label, customerName: posHeldSales.customerName, phone: posHeldSales.phone, email: posHeldSales.email, cart: posHeldSales.cart, discountAmount: posHeldSales.discountAmount, heldAtUnix: sql<number>`unix_timestamp(${posHeldSales.heldAt})` }).from(posHeldSales).where(and(eq(posHeldSales.sessionId, active.id), eq(posHeldSales.status, "HELD"))).orderBy(desc(posHeldSales.heldAt)),
    db.select({ id: posExpenses.id, category: posExpenses.category, description: posExpenses.description, amount: posExpenses.amount, paymentMethod: posExpenses.paymentMethod, reference: posExpenses.reference, incurredAtUnix: sql<number>`unix_timestamp(${posExpenses.incurredAt})` }).from(posExpenses).where(eq(posExpenses.sessionId, active.id)).orderBy(desc(posExpenses.incurredAt)),
    posSessionSummary(active.id),
  ]) : [[], [], null];
  const tillIds = new Set(branchRows.map((branch) => branch.id));
  const settings = settingsRows[0];
  const activeTillNumber = active ? tillRows.find((till) => till.id === active.tillId)?.mpesaTillNumber || null : null;
  return json({
    cashier: { id: auth.session.userId, name: auth.session.firstName, role: auth.session.role },
    cashiers: cashierRows.map((cashier) => ({ id: cashier.id, name: `${cashier.firstName} ${cashier.lastName}`.trim(), role: cashier.role, branchId: cashier.branchId })),
    branches: branchRows,
    tills: tillRows.filter((till) => tillIds.has(till.branchId)),
    products: productRows.map((product) => ({ ...product, imageUrl: publicImageUrl(product.imageUrl), price: Number(product.price), discountPrice: product.discountPrice === null ? null : Number(product.discountPrice) })),
    suppliers: supplierRows.map((supplier) => ({ id: supplier.id, name: supplier.name, phone: supplier.phone, lastReceivedAt: supplier.lastReceivedAtUnix === null ? null : new Date(Number(supplier.lastReceivedAtUnix) * 1000).toISOString() })),
    stock: stockRows.map((row) => ({ ...row, available: Number(row.available) })),
    activeSession: active ? { ...active, openingFloat: Number(active.openingFloat), openingCash: Number(active.openingCash), openedAt: new Date(Number(active.openedAtUnix) * 1000).toISOString() } : null,
    heldSales: held.map((row) => ({ ...row, discountAmount: Number(row.discountAmount), heldAt: new Date(Number(row.heldAtUnix) * 1000).toISOString() })),
    expenses: expenses.map((row) => ({ ...row, amount: Number(row.amount), incurredAt: new Date(Number(row.incurredAtUnix) * 1000).toISOString() })),
    totals,
    payment: {
      cashEnabled: settings?.posCashEnabled ?? true,
      mpesaEnabled: Boolean(settings?.posMpesaEnabled && mpesaConfiguration()),
      manualEnabled: Boolean(settings?.posManualEnabled && (activeTillNumber || settings?.mpesaTillNumber)),
      tillNumber: activeTillNumber || settings?.mpesaTillNumber || null,
      accountName: settings?.mpesaAccountName || null,
    },
    // The cashier screen may disclose VAT even when the site-wide receipt setting is off,
    // so the rate travels with the workspace regardless of the flag.
    vat: { enabled: Boolean(settings?.vatEnabled), rate: Number(settings?.vatRate ?? 0) },
  });
}

export async function handlePosSessions(request: Request, sessionId?: number, action?: "close") {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  const db = getDb();
  if (!sessionId && request.method === "POST") {
    const parsed = z.object({ branchId: z.coerce.number().int().positive(), tillId: z.coerce.number().int().positive(), openingFloat: moneySchema, openingCash: moneySchema }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Choose a branch and till, then enter valid opening figures." }, { status: 400 });
    if (auth.session.role === "STAFF" && auth.session.homeBranchId !== parsed.data.branchId) return json({ error: "POS is limited to your assigned shop." }, { status: 403 });
    try {
      const created = await db.transaction(async (tx) => {
        const [till] = await tx.select({ id: posTills.id, branchId: posTills.branchId }).from(posTills).where(and(eq(posTills.id, parsed.data.tillId), eq(posTills.branchId, parsed.data.branchId), eq(posTills.isActive, true))).limit(1).for("update");
        if (!till) throw new Error("Choose an active till for this branch.");
        const open = await tx.select({ id: posSessions.id, userId: posSessions.userId, tillId: posSessions.tillId }).from(posSessions).where(and(eq(posSessions.status, "OPEN"), sql`(${posSessions.userId} = ${auth.session.userId} or ${posSessions.tillId} = ${till.id})`)).limit(1);
        if (open[0]) throw new Error(open[0].userId === auth.session.userId ? "You already have an open POS session." : "This till is already open in another session.");
        const [branch] = await tx.select({ code: branches.code }).from(branches).where(and(eq(branches.id, parsed.data.branchId), eq(branches.isActive, true))).limit(1);
        if (!branch) throw new Error("Choose an active branch.");
        const number = sessionNumber(branch.code);
        const [row] = await tx.insert(posSessions).values({ sessionNumber: number, userId: auth.session.userId, branchId: parsed.data.branchId, tillId: parsed.data.tillId, openingFloat: parsed.data.openingFloat.toFixed(2), openingCash: parsed.data.openingCash.toFixed(2) });
        await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_SESSION_OPENED", entityType: "pos_session", entityId: String(row.insertId), metadata: { sessionNumber: number, branchId: parsed.data.branchId, tillId: parsed.data.tillId, openingFloat: parsed.data.openingFloat, openingCash: parsed.data.openingCash } });
        return { id: row.insertId, sessionNumber: number };
      });
      return json({ ok: true, ...created }, { status: 201 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The session could not be opened." }, { status: 409 });
    }
  }
  if (sessionId && action === "close" && request.method === "POST") {
    const parsed = z.object({ actualCash: moneySchema, notes: z.string().trim().max(2000).optional().default("") }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Enter the actual cash counted." }, { status: 400 });
    try {
      const closed = await db.transaction(async (tx) => {
        const [session] = await tx.select().from(posSessions).where(and(eq(posSessions.id, sessionId), eq(posSessions.userId, auth.session.userId))).limit(1).for("update");
        if (!session) throw new Error("POS session not found.");
        if (session.status === "CLOSED") return { alreadyClosed: true, expectedCash: Number(session.expectedCash), difference: Number(session.cashDifference) };
        const [pending] = await tx.select({ count: sql<number>`count(*)` }).from(orders).where(and(
          eq(orders.posSessionId, session.id),
          or(eq(orders.paymentStatus, "PENDING"), and(ne(orders.status, "COMPLETED"), ne(orders.status, "CANCELLED"))),
        ));
        const [held] = await tx.select({ count: sql<number>`count(*)` }).from(posHeldSales).where(and(eq(posHeldSales.sessionId, session.id), eq(posHeldSales.status, "HELD")));
        if (Number(pending.count) > 0) throw new Error(`${pending.count} unsettled sale(s) remain. Complete or cancel them before closing.`);
        if (Number(held.count) > 0) throw new Error(`${held.count} held sale(s) remain. Resume or cancel them before closing.`);
        const [cashRows, expenseRows] = await Promise.all([
          tx.select({ amount: paymentTransactions.amount }).from(paymentTransactions).innerJoin(orders, eq(orders.id, paymentTransactions.orderId)).where(and(eq(orders.posSessionId, session.id), eq(paymentTransactions.method, "CASH"), eq(paymentTransactions.status, "PAID"))),
          tx.select({ amount: posExpenses.amount }).from(posExpenses).where(and(eq(posExpenses.sessionId, session.id), eq(posExpenses.paymentMethod, "CASH"))),
        ]);
        const cashSales = cashRows.reduce((sum, row) => sum + Number(row.amount), 0);
        const cashExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount), 0);
        const expectedCash = expectedSessionCash({ openingCash: Number(session.openingCash), cashSales, cashExpenses });
        const difference = sessionCashDifference(parsed.data.actualCash, expectedCash);
        await tx.update(posSessions).set({ status: "CLOSED", actualCash: parsed.data.actualCash.toFixed(2), expectedCash: expectedCash.toFixed(2), cashDifference: difference.toFixed(2), closingNotes: parsed.data.notes || null, closedAt: sql`current_timestamp` }).where(and(eq(posSessions.id, session.id), eq(posSessions.status, "OPEN")));
        await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_SESSION_CLOSED", entityType: "pos_session", entityId: String(session.id), metadata: { sessionNumber: session.sessionNumber, expectedCash, actualCash: parsed.data.actualCash, difference } });
        return { alreadyClosed: false, expectedCash, difference };
      });
      let delivery: { emailSent: boolean; smsSent: number; ownerCount: number; branchFullyClosed?: boolean; remainingOpenSessions?: number; error?: string };
      try {
        delivery = await sendPosSessionCloseReport(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The close report could not be delivered.";
        console.error("POS session closed but its report delivery failed", { sessionId, error });
        delivery = { emailSent: false, smsSent: 0, ownerCount: 0, error: message };
      }
      return json({ ok: true, ...closed, notifications: delivery });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The session could not be closed." }, { status: 409 });
    }
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handlePosHeldSales(request: Request, heldId?: number) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  const db = getDb();
  if (!heldId && request.method === "POST") {
    const parsed = z.object({ sessionId: z.coerce.number().int().positive(), label: z.string().trim().min(1).max(160), customerName: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().optional().or(z.literal("")), cart: cartSchema, discountAmount: moneySchema.default(0) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "The held sale is incomplete." }, { status: 400 });
    const session = await actorOpenSession(parsed.data.sessionId, auth.session.userId);
    if (!session) return json({ error: "Open a POS session before holding a sale." }, { status: 409 });
    const [created] = await db.insert(posHeldSales).values({ sessionId: session.id, branchId: session.branchId, heldBy: auth.session.userId, label: parsed.data.label, customerName: parsed.data.customerName || null, phone: parsed.data.phone || null, email: parsed.data.email || null, cart: parsed.data.cart, discountAmount: parsed.data.discountAmount.toFixed(2) });
    await db.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_SALE_HELD", entityType: "pos_held_sale", entityId: String(created.insertId), metadata: { sessionId: session.id, label: parsed.data.label, itemCount: parsed.data.cart.length } });
    return json({ ok: true, id: created.insertId }, { status: 201 });
  }
  if (heldId && request.method === "PATCH") {
    const parsed = z.object({ action: z.enum(["RESUME", "CANCEL"]) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Choose resume or cancel." }, { status: 400 });
    const [held] = await db.select().from(posHeldSales).where(and(eq(posHeldSales.id, heldId), eq(posHeldSales.heldBy, auth.session.userId), eq(posHeldSales.status, "HELD"))).limit(1);
    if (!held) return json({ error: "Held sale not found or already handled." }, { status: 404 });
    const session = await actorOpenSession(held.sessionId, auth.session.userId);
    if (!session) return json({ error: "The session that held this sale is closed." }, { status: 409 });
    await db.update(posHeldSales).set({ status: parsed.data.action === "RESUME" ? "RESUMED" : "CANCELLED", resumedAt: parsed.data.action === "RESUME" ? sql`current_timestamp` : null }).where(eq(posHeldSales.id, held.id));
    await db.insert(activityLogs).values({ actorId: auth.session.userId, action: parsed.data.action === "RESUME" ? "POS_HELD_SALE_RESUMED" : "POS_HELD_SALE_CANCELLED", entityType: "pos_held_sale", entityId: String(held.id), metadata: { sessionId: held.sessionId } });
    return json({ ok: true, held: parsed.data.action === "RESUME" ? { ...held, discountAmount: Number(held.discountAmount) } : undefined });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handlePosExpenses(request: Request, expenseId?: number) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  const db = getDb();
  if (!expenseId && request.method === "POST") {
    const parsed = z.object({ sessionId: z.coerce.number().int().positive(), category: z.string().trim().min(2).max(100), description: z.string().trim().min(2).max(500), amount: moneySchema.refine((value) => value > 0), paymentMethod: z.enum(["CASH", "MPESA", "OTHER"]).default("CASH"), reference: z.string().trim().max(120).optional() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Enter an expense category, description and amount." }, { status: 400 });
    const session = await actorOpenSession(parsed.data.sessionId, auth.session.userId);
    if (!session) return json({ error: "Expenses can only be added to your open session." }, { status: 409 });
    const [created] = await db.insert(posExpenses).values({ sessionId: session.id, branchId: session.branchId, recordedBy: auth.session.userId, category: parsed.data.category, description: parsed.data.description, amount: parsed.data.amount.toFixed(2), paymentMethod: parsed.data.paymentMethod, reference: parsed.data.reference || null });
    await db.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_EXPENSE_RECORDED", entityType: "pos_expense", entityId: String(created.insertId), metadata: { sessionId: session.id, amount: parsed.data.amount, category: parsed.data.category } });
    return json({ ok: true, id: created.insertId }, { status: 201 });
  }
  if (expenseId && request.method === "DELETE") {
    const [expense] = await db.select().from(posExpenses).where(and(eq(posExpenses.id, expenseId), eq(posExpenses.recordedBy, auth.session.userId))).limit(1);
    if (!expense || !(await actorOpenSession(expense.sessionId, auth.session.userId))) return json({ error: "Only an expense from your open session can be removed." }, { status: 409 });
    await db.transaction(async (tx) => {
      await tx.delete(posExpenses).where(eq(posExpenses.id, expense.id));
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_EXPENSE_REMOVED", entityType: "pos_expense", entityId: String(expense.id), metadata: { sessionId: expense.sessionId, amount: expense.amount, category: expense.category } });
    });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

export async function handlePosStockReceipts(request: Request, receiptId?: number, image = false) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  const db = getDb();
  if (receiptId && image && request.method === "GET") {
    const [receipt] = await db.select({ path: posStockReceipts.receiptImagePath, sessionUserId: posSessions.userId }).from(posStockReceipts).innerJoin(posSessions, eq(posSessions.id, posStockReceipts.sessionId)).where(eq(posStockReceipts.id, receiptId)).limit(1);
    if (!receipt?.path || (auth.session.role === "STAFF" && receipt.sessionUserId !== auth.session.userId)) return json({ error: "Receipt image not found." }, { status: 404 });
    try {
      const filePath = path.join(storageRoot(), "pos-receipts", path.basename(receipt.path));
      const bytes = await readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const type = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
      return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300", "Content-Disposition": `inline; filename="${safeFilename(path.basename(filePath))}"` } });
    } catch { return json({ error: "Receipt file is unavailable." }, { status: 404 }); }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "The stock receipt form could not be read." }, { status: 400 });
  let rawItems: unknown = null;
  try { rawItems = JSON.parse(String(form.get("items") || "[]")); } catch { /* validated below */ }
  const parsed = z.object({
    sessionId: z.coerce.number().int().positive(), supplierName: z.string().trim().min(2).max(200), supplierPhone: z.string().trim().max(30).optional(), supplierInvoice: z.string().trim().max(120).optional(),
    items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(1_000_000), buyingPrice: moneySchema.refine((value) => value > 0), batchNumber: z.string().trim().max(120).optional(), expiryDate: expirySchema })).min(1).max(250),
  }).safeParse({ sessionId: form.get("sessionId"), supplierName: form.get("supplierName"), supplierPhone: form.get("supplierPhone") || undefined, supplierInvoice: form.get("supplierInvoice") || undefined, items: rawItems });
  if (!parsed.success || new Set(parsed.success ? parsed.data.items.map((item) => item.productId) : []).size !== (parsed.success ? parsed.data.items.length : 0)) return json({ error: "Enter the supplier and at least one unique product with quantity and buying price." }, { status: 400 });
  const session = await actorOpenSession(parsed.data.sessionId, auth.session.userId);
  if (!session) return json({ error: "Stock can only be received into your open session." }, { status: 409 });
  const file = form.get("receiptImage");
  let storedName: string | null = null;
  if (file instanceof File && file.size > 0) {
    const checked = await validatePrescriptionUpload(file);
    if (!checked.ok) return json({ error: checked.error }, { status: checked.status });
    storedName = `${Date.now()}-${randomUUID()}${checked.extension}`;
    const directory = path.join(storageRoot(), "pos-receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, storedName), checked.bytes);
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [branch] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, session.branchId)).limit(1);
      const catalog = await tx.select({ id: products.id }).from(products).where(inArray(products.id, parsed.data.items.map((item) => item.productId)));
      if (catalog.length !== parsed.data.items.length) throw new Error("One or more products no longer exist.");
      const number = receiptNumber(branch?.code || String(session.branchId));
      const supplierName = parsed.data.supplierName.replace(/\s+/g, " ").trim();
      const supplierKey = supplierName.toLocaleLowerCase("en");
      const supplierPhone = parsed.data.supplierPhone?.trim() || null;
      const totalCost = parsed.data.items.reduce((sum, item) => sum + item.buyingPrice * item.quantity, 0);
      const supplierUpdate = supplierPhone
        ? { name: supplierName, phone: supplierPhone, lastReceivedAt: new Date() }
        : { name: supplierName, lastReceivedAt: new Date() };
      await tx.insert(posSuppliers).values({ name: supplierName, nameKey: supplierKey, phone: supplierPhone, createdBy: auth.session.userId, lastReceivedAt: new Date() }).onDuplicateKeyUpdate({ set: supplierUpdate });
      const [supplier] = await tx.select({ id: posSuppliers.id, phone: posSuppliers.phone }).from(posSuppliers).where(eq(posSuppliers.nameKey, supplierKey)).limit(1);
      if (!supplier) throw new Error("The supplier could not be registered.");
      const [created] = await tx.insert(posStockReceipts).values({ receiptNumber: number, sessionId: session.id, branchId: session.branchId, receivedBy: auth.session.userId, supplierId: supplier.id, supplierName, supplierPhone: supplierPhone || supplier.phone || null, supplierInvoice: parsed.data.supplierInvoice || null, receiptImagePath: storedName, totalCost: totalCost.toFixed(2) });
      for (const item of parsed.data.items) {
        const [line] = await tx.insert(posStockReceiptItems).values({ receiptId: created.insertId, productId: item.productId, quantity: item.quantity, buyingPrice: item.buyingPrice.toFixed(2), lineTotal: (item.buyingPrice * item.quantity).toFixed(2), batchNumber: item.batchNumber || null, expiryDate: item.expiryDate || null });
        await tx.insert(productBatches).values({ branchId: session.branchId, productId: item.productId, stockReceiptItemId: line.insertId, batchNumber: item.batchNumber || null, expiryDate: item.expiryDate || null, quantityReceived: item.quantity, quantityRemaining: item.quantity, unitCost: item.buyingPrice.toFixed(2) });
        const [stock] = await tx.select().from(branchInventory).where(and(eq(branchInventory.branchId, session.branchId), eq(branchInventory.productId, item.productId))).limit(1).for("update");
        if (stock) await tx.update(branchInventory).set({ quantityAvailable: stock.quantityAvailable + item.quantity, updatedBy: auth.session.userId }).where(eq(branchInventory.id, stock.id));
        else await tx.insert(branchInventory).values({ branchId: session.branchId, productId: item.productId, quantityAvailable: item.quantity, quantityReserved: 0, reorderLevel: 5, updatedBy: auth.session.userId });
        await tx.update(products).set({ costPrice: item.buyingPrice.toFixed(2), costPriceEstimated: false }).where(eq(products.id, item.productId));
      }
      await tx.insert(activityLogs).values({ actorId: auth.session.userId, action: "POS_STOCK_RECEIVED", entityType: "pos_stock_receipt", entityId: String(created.insertId), metadata: { sessionId: session.id, branchId: session.branchId, supplier: supplierName, supplierId: supplier.id, itemCount: parsed.data.items.length, totalCost } });
      return { id: created.insertId, receiptNumber: number, totalCost };
    });
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (storedName) await unlink(path.join(storageRoot(), "pos-receipts", storedName)).catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : "Stock could not be received." }, { status: 409 });
  }
}

export async function posSessionSummary(sessionId: number) {
  const db = getDb();
  const [sessionRows, orderRows, paymentRows, expenseRows, lineRows, receivedRows] = await Promise.all([
    db.select({ id: posSessions.id, sessionNumber: posSessions.sessionNumber, branchId: posSessions.branchId, openingFloat: posSessions.openingFloat, openingCash: posSessions.openingCash, actualCash: posSessions.actualCash, expectedCash: posSessions.expectedCash, cashDifference: posSessions.cashDifference, closingNotes: posSessions.closingNotes, openedAtUnix: sql<number>`unix_timestamp(${posSessions.openedAt})`, closedAtUnix: sql<number>`unix_timestamp(${posSessions.closedAt})`, branchName: branches.name, tillName: posTills.name, cashierFirst: users.firstName, cashierLast: users.lastName }).from(posSessions).innerJoin(branches, eq(branches.id, posSessions.branchId)).innerJoin(posTills, eq(posTills.id, posSessions.tillId)).innerJoin(users, eq(users.id, posSessions.userId)).where(eq(posSessions.id, sessionId)).limit(1),
    db.select({ id: orders.id, total: orders.total, discount: orders.discount, transactedAtUnix: sql<number>`unix_timestamp(coalesce(${orders.transactedAt},${orders.createdAt}))` }).from(orders).where(and(eq(orders.posSessionId, sessionId), eq(orders.paymentStatus, "PAID"))),
    db.select({ method: paymentTransactions.method, status: paymentTransactions.status, amount: paymentTransactions.amount }).from(paymentTransactions).innerJoin(orders, eq(orders.id, paymentTransactions.orderId)).where(and(eq(orders.posSessionId, sessionId), inArray(paymentTransactions.status, ["PAID", "REFUNDED"]))),
    db.select({ amount: posExpenses.amount, paymentMethod: posExpenses.paymentMethod }).from(posExpenses).where(eq(posExpenses.sessionId, sessionId)),
    db.select({ orderId: orderItems.orderId, productName: orderItems.productName, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal, unitCost: orderItems.unitCost, productCost: products.costPrice }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).leftJoin(products, eq(products.id, orderItems.productId)).where(and(eq(orders.posSessionId, sessionId), eq(orders.paymentStatus, "PAID"))),
    db.select({ quantity: posStockReceiptItems.quantity }).from(posStockReceiptItems).innerJoin(posStockReceipts, eq(posStockReceipts.id, posStockReceiptItems.receiptId)).where(eq(posStockReceipts.sessionId, sessionId)),
  ]);
  const session = sessionRows[0];
  if (!session) return null;
  const paid = paymentRows.filter((row) => row.status === "PAID");
  const cashSales = paid.filter((row) => row.method === "CASH").reduce((sum, row) => sum + Number(row.amount), 0);
  const mpesaSales = paid.filter((row) => row.method === "MPESA_EXPRESS").reduce((sum, row) => sum + Number(row.amount), 0);
  const manualSales = paid.filter((row) => row.method === "MANUAL_MPESA").reduce((sum, row) => sum + Number(row.amount), 0);
  const refunds = paymentRows.filter((row) => row.status === "REFUNDED").reduce((sum, row) => sum + Number(row.amount), 0);
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.amount), 0);
  const cashExpenses = expenseRows.filter((row) => row.paymentMethod === "CASH").reduce((sum, row) => sum + Number(row.amount), 0);
  const profit = summariseProfit(lineRows).profit;
  const top = new Map<string, { units: number; sales: number }>();
  for (const line of lineRows) {
    const value = top.get(line.productName) || { units: 0, sales: 0 };
    value.units += line.quantity;
    value.sales += Number(line.lineTotal);
    top.set(line.productName, value);
  }
  const hourly = new Map<string, number>();
  for (const order of orderRows) {
    const time = new Date(Number(order.transactedAtUnix) * 1000);
    const hour = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", hourCycle: "h23" }).format(time) + ":00";
    hourly.set(hour, (hourly.get(hour) || 0) + Number(order.total));
  }
  const openingCash = Number(session.openingCash);
  const expectedCash = session.expectedCash === null ? expectedSessionCash({ openingCash, cashSales, cashExpenses }) : Number(session.expectedCash);
  return {
    session: { id: session.id, sessionNumber: session.sessionNumber, branchId: session.branchId, branchName: session.branchName, tillName: session.tillName, cashierName: `${session.cashierFirst} ${session.cashierLast}`.trim(), openedAt: new Date(Number(session.openedAtUnix) * 1000).toISOString(), closedAt: session.closedAtUnix ? new Date(Number(session.closedAtUnix) * 1000).toISOString() : null, closingNotes: session.closingNotes },
    sales: orderRows.reduce((sum, row) => sum + Number(row.total), 0), profit, cashSales, mpesaSales, manualSales, refunds,
    discounts: orderRows.reduce((sum, row) => sum + Number(row.discount), 0), expenses, cashExpenses,
    openingFloat: Number(session.openingFloat), openingCash, expectedCash,
    actualCash: session.actualCash === null ? null : Number(session.actualCash), cashDifference: session.cashDifference === null ? null : Number(session.cashDifference),
    transactionCount: orderRows.length, stockReceivedUnits: receivedRows.reduce((sum, row) => sum + row.quantity, 0),
    topProducts: [...top].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.sales - a.sales).slice(0, 8),
    hourlySales: [...hourly].map(([hour, sales]) => ({ hour, sales })).sort((a, b) => a.hour.localeCompare(b.hour)),
  };
}

async function sendPosSessionCloseReport(sessionId: number) {
  const summary = await posSessionSummary(sessionId);
  if (!summary?.session.closedAt || summary.actualCash === null || summary.cashDifference === null) return { emailSent: false, smsSent: 0, ownerCount: 0, error: "Session summary is incomplete." };
  const db = getDb();
  const [owners, remainingRows] = await Promise.all([
    db.select({ firstName: users.firstName, email: users.email, phone: users.phone }).from(users).where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true))),
    db.select({ count: sql<number>`count(*)` }).from(posSessions).where(and(eq(posSessions.branchId, summary.session.branchId), eq(posSessions.status, "OPEN"), ne(posSessions.id, summary.session.id))),
  ]);
  const remainingOpenSessions = Number(remainingRows[0]?.count || 0);
  const branchFullyClosed = remainingOpenSessions === 0;
  const data: PosSessionReportData = {
    sessionNumber: summary.session.sessionNumber, branchName: summary.session.branchName, tillName: summary.session.tillName, cashierName: summary.session.cashierName,
    openedAt: summary.session.openedAt, closedAt: summary.session.closedAt, openingFloat: summary.openingFloat, openingCash: summary.openingCash,
    sales: summary.sales, profit: summary.profit, cashSales: summary.cashSales, mpesaSales: summary.mpesaSales, manualSales: summary.manualSales,
    discounts: summary.discounts, expenses: summary.expenses, cashExpenses: summary.cashExpenses, expectedCash: summary.expectedCash, actualCash: summary.actualCash, cashDifference: summary.cashDifference,
    transactionCount: summary.transactionCount, stockReceivedUnits: summary.stockReceivedUnits, closingNotes: summary.session.closingNotes,
    topProducts: summary.topProducts, hourlySales: summary.hourlySales,
  };
  const pdf = await renderPosSessionReport(data);
  const email = owners.length ? await sendEmail({
    to: owners.map((owner) => owner.email), channel: "orders",
    subject: `${summary.session.branchName} POS session closed · ${summary.session.sessionNumber}`,
    message: `${summary.session.cashierName} closed ${summary.session.tillName} at ${nairobiDateTime(summary.session.closedAt)} Kenya time.\n\nSales: KES ${summary.sales.toLocaleString("en-KE")}\nExpected cash: KES ${summary.expectedCash.toLocaleString("en-KE")}\nActual cash: KES ${summary.actualCash.toLocaleString("en-KE")}\nCash difference: KES ${summary.cashDifference.toLocaleString("en-KE")}\n\nThe complete PDF report with graphs is attached.`,
    attachments: [{ filename: `${safeFilename(summary.session.sessionNumber)}.pdf`, content: pdf, contentType: "application/pdf" }],
  }) : { sent: false as const, reason: "no-owners" as const };
  let smsSent = 0;
  for (const owner of owners) {
    if (!owner.phone) continue;
    const status = branchFullyClosed
      ? `${summary.session.branchName} has closed its last open POS session`
      : `${summary.session.cashierName}'s ${summary.session.tillName} session at ${summary.session.branchName} has closed; ${remainingOpenSessions} session${remainingOpenSessions === 1 ? " remains" : "s remain"} open`;
    const outcome = await sendSms({ to: owner.phone, purpose: "POS_SESSION_CLOSED", message: `Hello ${owner.firstName}, ${status}. Session sales: KES ${Math.round(summary.sales).toLocaleString("en-KE")}. Check your email for the session report.` });
    smsSent += outcome.sent;
  }
  if (email.sent) await db.update(posSessions).set({ reportSentAt: sql`current_timestamp` }).where(eq(posSessions.id, sessionId));
  return { emailSent: email.sent, smsSent, ownerCount: owners.length, branchFullyClosed, remainingOpenSessions };
}

export async function handlePosReports(request: Request) {
  const auth = await requireTeamPermission(request, "POS_USE");
  if (isAuthResponse(auth)) return auth.response;
  const url = new URL(request.url);
  const now = new Date();
  const kenyaDate = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  };
  const fromDate = url.searchParams.get("from") || kenyaDate(new Date(now.getTime() - 30 * 24 * 60 * 60_000));
  const toDate = url.searchParams.get("to") || kenyaDate(now);
  const from = new Date(`${fromDate}T00:00:00+03:00`);
  const to = new Date(`${toDate}T23:59:59.999+03:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return json({ error: "Choose a valid report date range." }, { status: 400 });
  const branchId = Number(url.searchParams.get("branchId") || 0);
  const cashierId = Number(url.searchParams.get("cashierId") || 0);
  const productId = Number(url.searchParams.get("productId") || 0);
  const conditions = [gte(orders.transactedAt, from), lte(orders.transactedAt, to), eq(orders.paymentStatus, "PAID"), sql`${orders.posSessionId} is not null`];
  if (auth.session.role === "STAFF") conditions.push(eq(orders.suggestedBranchId, auth.session.homeBranchId!));
  else if (branchId > 0) conditions.push(eq(orders.suggestedBranchId, branchId));
  if (cashierId > 0) conditions.push(eq(orders.cashierId, cashierId));
  const db = getDb();
  if (productId > 0) {
    const matchingOrders = await db.selectDistinct({ orderId: orderItems.orderId }).from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(...conditions, eq(orderItems.productId, productId)));
    if (matchingOrders.length) conditions.push(inArray(orders.id, matchingOrders.map((row) => row.orderId)));
    else conditions.push(sql`false`);
  }
  const [saleRows, lineRows, paymentRows, sessionRows, stockReceived, expiring, lowStock] = await Promise.all([
    db.select({ id: orders.id, total: orders.total, discount: orders.discount, date: sql<string>`date_format(convert_tz(${orders.transactedAt}, '+00:00', '+03:00'), '%Y-%m-%d')`, cashierId: orders.cashierId, cashierFirst: users.firstName, cashierLast: users.lastName, branchId: orders.suggestedBranchId, branchName: branches.name }).from(orders).leftJoin(users, eq(users.id, orders.cashierId)).leftJoin(branches, eq(branches.id, orders.suggestedBranchId)).where(and(...conditions)),
    db.select({ productId: orderItems.productId, productName: orderItems.productName, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal, unitCost: orderItems.unitCost, productCost: products.costPrice }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).leftJoin(products, eq(products.id, orderItems.productId)).where(and(...conditions, ...(productId > 0 ? [eq(orderItems.productId, productId)] : []))),
    db.select({ method: paymentTransactions.method, status: paymentTransactions.status, amount: paymentTransactions.amount }).from(paymentTransactions).innerJoin(orders, eq(orders.id, paymentTransactions.orderId)).where(and(...conditions, inArray(paymentTransactions.status, ["PAID", "REFUNDED"]))),
    db.select({ sessionNumber: posSessions.sessionNumber, branchId: posSessions.branchId, branchName: branches.name, cashierId: posSessions.userId, cashierFirst: users.firstName, cashierLast: users.lastName, openedAt: posSessions.openedAt, closedAt: posSessions.closedAt, sales: sql<number>`coalesce(sum(${orders.total}),0)`, expectedCash: posSessions.expectedCash, actualCash: posSessions.actualCash, cashDifference: posSessions.cashDifference }).from(posSessions).innerJoin(branches, eq(branches.id, posSessions.branchId)).innerJoin(users, eq(users.id, posSessions.userId)).leftJoin(orders, and(eq(orders.posSessionId, posSessions.id), eq(orders.paymentStatus, "PAID"))).where(and(gte(posSessions.openedAt, from), lte(posSessions.openedAt, to), ...(auth.session.role === "STAFF" ? [eq(posSessions.branchId, auth.session.homeBranchId!)] : branchId > 0 ? [eq(posSessions.branchId, branchId)] : []), ...(cashierId > 0 ? [eq(posSessions.userId, cashierId)] : []))).groupBy(posSessions.id).orderBy(desc(posSessions.openedAt)),
    db.select({ receiptNumber: posStockReceipts.receiptNumber, supplier: posStockReceipts.supplierName, branch: branches.name, product: products.name, quantity: posStockReceiptItems.quantity, buyingPrice: posStockReceiptItems.buyingPrice, batchNumber: posStockReceiptItems.batchNumber, expiryDate: posStockReceiptItems.expiryDate, receivedAt: posStockReceipts.receivedAt }).from(posStockReceiptItems).innerJoin(posStockReceipts, eq(posStockReceipts.id, posStockReceiptItems.receiptId)).innerJoin(products, eq(products.id, posStockReceiptItems.productId)).innerJoin(branches, eq(branches.id, posStockReceipts.branchId)).where(and(gte(posStockReceipts.receivedAt, from), lte(posStockReceipts.receivedAt, to), ...(auth.session.role === "STAFF" ? [eq(posStockReceipts.branchId, auth.session.homeBranchId!)] : branchId > 0 ? [eq(posStockReceipts.branchId, branchId)] : []), ...(productId > 0 ? [eq(posStockReceiptItems.productId, productId)] : []))).orderBy(desc(posStockReceipts.receivedAt)),
    db.select({ product: products.name, branch: branches.name, batchNumber: productBatches.batchNumber, expiryDate: productBatches.expiryDate, quantityRemaining: productBatches.quantityRemaining }).from(productBatches).innerJoin(products, eq(products.id, productBatches.productId)).innerJoin(branches, eq(branches.id, productBatches.branchId)).where(and(sql`${productBatches.expiryDate} is not null`, gte(productBatches.expiryDate, new Date().toISOString().slice(0, 10)), lte(productBatches.expiryDate, new Date(Date.now() + 120 * 24 * 60 * 60_000).toISOString().slice(0, 10)), sql`${productBatches.quantityRemaining} > 0`, ...(auth.session.role === "STAFF" ? [eq(productBatches.branchId, auth.session.homeBranchId!)] : branchId > 0 ? [eq(productBatches.branchId, branchId)] : []), ...(productId > 0 ? [eq(productBatches.productId, productId)] : []))).orderBy(asc(productBatches.expiryDate)),
    db.select({ product: products.name, branch: branches.name, available: sql<number>`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`, reorderLevel: branchInventory.reorderLevel }).from(branchInventory).innerJoin(products, eq(products.id, branchInventory.productId)).innerJoin(branches, eq(branches.id, branchInventory.branchId)).where(and(sql`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved} <= ${branchInventory.reorderLevel}`, ...(auth.session.role === "STAFF" ? [eq(branchInventory.branchId, auth.session.homeBranchId!)] : branchId > 0 ? [eq(branchInventory.branchId, branchId)] : []), ...(productId > 0 ? [eq(branchInventory.productId, productId)] : []))).orderBy(asc(sql`${branchInventory.quantityAvailable} - ${branchInventory.quantityReserved}`)),
  ]);
  const daily = new Map<string, { sales: number; orders: number }>();
  for (const row of saleRows) { const value = daily.get(row.date) || { sales: 0, orders: 0 }; value.sales += Number(row.total); value.orders += 1; daily.set(row.date, value); }
  const methods = new Map<string, number>();
  for (const row of paymentRows.filter((row) => row.status === "PAID")) methods.set(row.method, (methods.get(row.method) || 0) + Number(row.amount));
  const productsMap = new Map<string, { units: number; sales: number }>();
  for (const row of lineRows) { const value = productsMap.get(row.productName) || { units: 0, sales: 0 }; value.units += row.quantity; value.sales += Number(row.lineTotal); productsMap.set(row.productName, value); }
  const cashiers = new Map<string, { cashierId: number | null; sales: number; orders: number }>();
  for (const row of saleRows) { const name = `${row.cashierFirst || "Unknown"} ${row.cashierLast || "cashier"}`.trim(); const value = cashiers.get(name) || { cashierId: row.cashierId, sales: 0, orders: 0 }; value.sales += Number(row.total); value.orders += 1; cashiers.set(name, value); }
  const profit = summariseProfit(lineRows);
  return json({
    filters: { from: from.toISOString(), to: to.toISOString(), branchId: branchId || null, cashierId: cashierId || null, productId: productId || null },
    summary: { sales: saleRows.reduce((sum, row) => sum + Number(row.total), 0), orders: saleRows.length, discounts: saleRows.reduce((sum, row) => sum + Number(row.discount), 0), refunds: paymentRows.filter((row) => row.status === "REFUNDED").reduce((sum, row) => sum + Number(row.amount), 0), profit: auth.session.role === "SUPER_ADMIN" ? profit.profit : null, unpricedSales: auth.session.role === "SUPER_ADMIN" ? profit.unpricedSales : null },
    dailySales: [...daily].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
    paymentMethods: [...methods].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    cashierPerformance: [...cashiers].map(([cashier, value]) => ({ cashier, ...value })).sort((a, b) => b.sales - a.sales),
    bestProducts: [...productsMap].map(([product, value]) => ({ product, ...value })).sort((a, b) => b.sales - a.sales).slice(0, 20),
    sessions: sessionRows.map((row) => ({ ...row, sales: Number(row.sales), expectedCash: row.expectedCash === null ? null : Number(row.expectedCash), actualCash: row.actualCash === null ? null : Number(row.actualCash), cashDifference: row.cashDifference === null ? null : Number(row.cashDifference) })),
    lowStock, expiringProducts: expiring, stockReceived,
  });
}
