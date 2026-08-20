import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { activeOrderStatuses } from "../../app/admin/order-buckets";
import { summariseProfit } from "../../lib/profit";
import { activityLogs, orderItems, orders, products, users } from "../../db/schema";
import type { RowDataPacket } from "mysql2";
import { getDb, getPool } from "./db";
import { requireSession } from "./auth";
import { sendEmail } from "./email";
import { json } from "./http";

/**
 * The end-of-day sales and profit note for whoever owns the business.
 *
 * Two rules shape it. It is only sent on days that had sales, because a nightly email
 * saying nothing happened trains people to ignore the one that matters. And every
 * boundary is decided by MySQL rather than Node: the API host runs UTC while the
 * database runs +03:00, so "today" is only unambiguous if one clock answers for it.
 */

const REPORT_HOUR_NAIROBI = 23;

export type DailyReport = {
  date: string;
  sales: number;
  profit: number;
  cost: number;
  orderCount: number;
  estimatedSales: number;
  unpricedSales: number;
  pipeline: Array<{ status: string; count: number }>;
  topProducts: Array<{ name: string; units: number; sales: number; profit: number }>;
};

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;
const readable = (status: string) => status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

/** Everything the note reports, for the trading day the database is currently in. */
export async function buildDailyReport(): Promise<DailyReport> {
  const db = getDb();
  const today = sql`date(${orders.createdAt}) = curdate()`;
  const [dateRows, lines, pipelineRows] = await Promise.all([
    // Asked of the database directly rather than through a table, so an empty shop
    // still knows what day it is.
    getPool().query<RowDataPacket[]>("select date_format(curdate(), '%W, %e %M %Y') as day"),
    db
      .select({
        orderId: orders.id,
        productName: orderItems.productName,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        unitCost: orderItems.unitCost,
        productCost: products.costPrice,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(products.id, orderItems.productId))
      // Paid only. An order that has not been paid for is a hope, not a sale.
      .where(and(today, eq(orders.paymentStatus, "PAID"))),
    db
      .select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders)
      .where(inArray(orders.status, [...activeOrderStatuses]))
      .groupBy(orders.status),
  ]);

  const summary = summariseProfit(lines);
  const perProduct = new Map<string, { units: number; sales: number; profit: number }>();
  for (const line of lines) {
    const entry = perProduct.get(line.productName) || { units: 0, sales: 0, profit: 0 };
    const single = summariseProfit([line]);
    entry.units += Number(line.quantity) || 0;
    entry.sales += single.sales;
    entry.profit += single.profit;
    perProduct.set(line.productName, entry);
  }

  return {
    date: String(dateRows[0][0]?.day || "") || new Date().toDateString(),
    sales: summary.sales,
    profit: summary.profit,
    cost: summary.cost,
    orderCount: new Set(lines.map((line) => line.orderId)).size,
    estimatedSales: summary.estimatedSales,
    unpricedSales: summary.unpricedSales,
    // Every open stage, including the empty ones: a stage holding nothing is worth
    // seeing, and a stage that quietly disappeared from the list is not.
    pipeline: activeOrderStatuses.map((status) => ({
      status,
      count: Number(pipelineRows.find((row) => row.status === status)?.count ?? 0),
    })),
    topProducts: [...perProduct]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((first, second) => second.sales - first.sales)
      .slice(0, 5),
  };
}

function reportHtml(report: DailyReport) {
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;color:#4a444d">${label}</td><td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;color:#2a1730;font-weight:${strong ? 800 : 600}">${value}</td></tr>`;
  const products = report.topProducts
    .map((item) => row(`${item.name} <span style="color:#8a828f">&times;${item.units}</span>`, `${money(item.sales)} <span style="color:#2f8b52">+${money(item.profit)}</span>`))
    .join("");
  const pipeline = report.pipeline
    .map((stage) => row(readable(stage.status), String(stage.count)))
    .join("");
  const caveats = [
    report.estimatedSales > 0 ? `${money(report.estimatedSales)} of today's sales used an estimated buying price.` : "",
    report.unpricedSales > 0 ? `${money(report.unpricedSales)} had no buying price at all and is excluded from profit.` : "",
  ].filter(Boolean);

  return `<!doctype html><html><body style="margin:0;background:#f6f3f7;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="padding:20px 24px;background:#74247f;color:#fff">
  <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Healthfield Pharmacy</div>
  <div style="font-size:20px;font-weight:800;margin-top:4px">Daily sales &amp; profit</div>
  <div style="font-size:12px;opacity:.9;margin-top:2px">${report.date}</div>
</td></tr>
<tr><td style="padding:20px 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
    ${row("Sales today", money(report.sales), true)}
    ${row("Cost of goods sold", money(report.cost))}
    ${row("Profit today", money(report.profit), true)}
    ${row("Paid orders", String(report.orderCount))}
  </table>
  <div style="margin-top:22px;font-size:13px;font-weight:800;color:#2a1730">Best sellers today</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;margin-top:6px">${products || row("No product lines", "—")}</table>
  <div style="margin-top:22px;font-size:13px;font-weight:800;color:#2a1730">Orders still in progress</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;margin-top:6px">${pipeline}</table>
  ${caveats.length ? `<p style="margin:18px 0 0;padding:10px 12px;border-radius:8px;background:#fff8ec;color:#89521d;font-size:11px;line-height:1.6">${caveats.join("<br/>")}</p>` : ""}
</td></tr>
<tr><td style="padding:0 24px 22px"><a href="${(process.env.APP_URL || "https://healthfieldpharmacy.co.ke").replace(/\/$/, "")}/admin" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#74247f;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Open the dashboard</a></td></tr>
</table></td></tr></table></body></html>`;
}

function reportText(report: DailyReport) {
  const lines = [
    `Healthfield Pharmacy — daily sales and profit, ${report.date}`,
    "",
    `Sales today: ${money(report.sales)}`,
    `Cost of goods sold: ${money(report.cost)}`,
    `Profit today: ${money(report.profit)}`,
    `Paid orders: ${report.orderCount}`,
    "",
    "Best sellers today:",
    ...(report.topProducts.length ? report.topProducts.map((item) => `  ${item.name} x${item.units} — ${money(item.sales)} (profit ${money(item.profit)})`) : ["  None"]),
    "",
    "Orders still in progress:",
    ...report.pipeline.map((stage) => `  ${readable(stage.status)}: ${stage.count}`),
  ];
  if (report.estimatedSales > 0) lines.push("", `${money(report.estimatedSales)} of today's sales used an estimated buying price.`);
  if (report.unpricedSales > 0) lines.push(`${money(report.unpricedSales)} had no buying price and is excluded from profit.`);
  return lines.join("\n");
}

/** Who gets it: every active owner account. Adding an owner enrols them automatically. */
async function reportRecipients() {
  const rows = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true)));
  return [...new Set(rows.map((row) => row.email).filter(Boolean))];
}

/**
 * Sends the note, unless it has already gone out for this trading day.
 *
 * The guard is a database row rather than a timer's memory, so a restarted or
 * idled-out process cannot send it twice, and a process that was asleep at eleven
 * still sends it when it next wakes.
 */
export async function sendDailySalesReport(options: { force?: boolean } = {}) {
  const db = getDb();
  const [alreadySent] = await db
    .select({ id: activityLogs.id })
    .from(activityLogs)
    .where(and(eq(activityLogs.action, "DAILY_SALES_REPORT_SENT"), sql`date(${activityLogs.createdAt}) = curdate()`))
    .orderBy(desc(activityLogs.id))
    .limit(1);
  if (alreadySent && !options.force) return { sent: false, reason: "already-sent-today" as const };

  const report = await buildDailyReport();
  // Quiet days stay quiet. Nothing was sold, so there is nothing to report.
  if (report.sales <= 0) return { sent: false, reason: "no-sales" as const, report };

  const recipients = await reportRecipients();
  if (!recipients.length) return { sent: false, reason: "no-recipients" as const, report };

  const delivery = await sendEmail({
    to: recipients,
    subject: `Sales today: ${money(report.sales)} · profit ${money(report.profit)}`,
    message: reportText(report),
    html: reportHtml(report),
    channel: "orders",
  });
  if (!delivery.sent) return { sent: false, reason: "send-failed" as const, report };

  await db.insert(activityLogs).values({
    actorId: null,
    action: "DAILY_SALES_REPORT_SENT",
    entityType: "daily_report",
    entityId: null,
    metadata: { sales: report.sales, profit: report.profit, orders: report.orderCount, recipients: recipients.length },
  });
  return { sent: true, report, recipients: recipients.length };
}

/**
 * Sends tonight's note now, on request.
 *
 * The nightly send is unattended, which makes it hard to trust before it has fired for
 * the first time. This lets an owner see the real thing, built from real figures, at
 * any hour — and it deliberately bypasses the once-a-day guard so it can be run twice
 * while checking something.
 */
export async function handleDailyReportSend(request: Request) {
  const auth = await requireSession(request, ["SUPER_ADMIN"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  const result = await sendDailySalesReport({ force: true });
  if (result.sent) return json({ ok: true, message: `Today's report has been emailed to ${result.recipients} owner mailbox(es).`, report: result.report });
  const message = result.reason === "no-sales"
    ? "Nothing has been sold yet today, so there is no report to send."
    : result.reason === "no-recipients"
      ? "No active owner account has an email address to send it to."
      : "The report could not be emailed. Check the SMTP settings in the API environment.";
  return json({ ok: false, error: message, report: "report" in result ? result.report : undefined }, { status: 409 });
}

/**
 * The nightly check, run on a short interval rather than a cron.
 *
 * Passenger idles this process out between requests, so an exact 23:00 wake-up is not
 * something a timer can promise. Instead every tick asks the database what time it is
 * there, and sends once the trading day has passed eleven — late is acceptable for a
 * summary of a day that has already ended, twice is not, and the activity-log guard is
 * what rules the second one out.
 */
export async function runDailyReportIfDue() {
  const [rows] = await getPool().query<RowDataPacket[]>("select hour(current_timestamp) as hour");
  const hour = Number(rows[0]?.hour ?? -1);
  if (!Number.isFinite(hour) || hour < REPORT_HOUR_NAIROBI) return { sent: false, reason: "too-early" as const };
  return sendDailySalesReport();
}
