import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { nairobiDateTime } from "../../lib/pos";

export type PosSessionReportData = {
  sessionNumber: string;
  branchName: string;
  tillName: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  openingCash: number;
  sales: number;
  profit: number;
  cashSales: number;
  mpesaSales: number;
  manualSales: number;
  discounts: number;
  expenses: number;
  cashExpenses: number;
  expectedCash: number;
  actualCash: number;
  cashDifference: number;
  transactionCount: number;
  stockReceivedUnits: number;
  closingNotes?: string | null;
  topProducts: Array<{ name: string; units: number; sales: number }>;
  hourlySales: Array<{ hour: string; sales: number }>;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 9, color: "#24192a", backgroundColor: "#fff" },
  header: { padding: 18, borderRadius: 10, backgroundColor: "#70227e", color: "#fff", marginBottom: 18 },
  eyebrow: { fontSize: 8, letterSpacing: 1.2, marginBottom: 5 },
  title: { fontSize: 20, fontWeight: 700 },
  meta: { marginTop: 7, fontSize: 8.5, lineHeight: 1.5 },
  sectionTitle: { marginTop: 16, marginBottom: 7, fontSize: 11, fontWeight: 700, color: "#70227e" },
  metrics: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 7 },
  metric: { width: "31.8%", padding: 10, borderRadius: 7, backgroundColor: "#f7f1f8" },
  metricLabel: { fontSize: 7, color: "#756a79", marginBottom: 4 },
  metricValue: { fontSize: 13, fontWeight: 700 },
  row: { display: "flex", flexDirection: "row", paddingVertical: 6, borderBottom: "1 solid #eee8ef" },
  grow: { flexGrow: 1 },
  barRow: { marginBottom: 7 },
  barLabels: { display: "flex", flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: "#eee8f0" },
  bar: { height: 8, borderRadius: 4, backgroundColor: "#b82e83" },
  note: { marginTop: 14, padding: 10, borderRadius: 7, backgroundColor: "#fff7e9", color: "#704813", lineHeight: 1.5 },
  footer: { marginTop: 18, color: "#887f8c", fontSize: 7 },
});

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

export async function renderPosSessionReport(data: PosSessionReportData) {
  const maxHourly = Math.max(1, ...data.hourlySales.map((item) => item.sales));
  const metric = (label: string, value: string) => h(View, { style: styles.metric, key: label },
    h(Text, { style: styles.metricLabel }, label),
    h(Text, { style: styles.metricValue }, value),
  );
  const doc = h(Document, null,
    h(Page, { size: "A4", style: styles.page },
      h(View, { style: styles.header },
        h(Text, { style: styles.eyebrow }, "HEALTHFIELD PHARMACY · POS SESSION REPORT"),
        h(Text, { style: styles.title }, data.sessionNumber),
        h(Text, { style: styles.meta }, `${data.branchName} · ${data.tillName}\nCashier: ${data.cashierName}\nOpened: ${nairobiDateTime(data.openedAt)} · Closed: ${nairobiDateTime(data.closedAt)} (Kenya time)`),
      ),
      h(Text, { style: styles.sectionTitle }, "Session summary"),
      h(View, { style: styles.metrics },
        metric("Sales", money(data.sales)),
        metric("Transactions", String(data.transactionCount)),
        metric("Profit (owner)", money(data.profit)),
        metric("Cash", money(data.cashSales)),
        metric("M-PESA", money(data.mpesaSales + data.manualSales)),
        metric("Discounts", money(data.discounts)),
        metric("Expenses", money(data.expenses)),
        metric("Stock received", `${data.stockReceivedUnits} units`),
        metric("Cash difference", `${data.cashDifference >= 0 ? "+" : ""}${money(data.cashDifference)}`),
      ),
      h(Text, { style: styles.sectionTitle }, "Cash reconciliation"),
      ...[
        ["Opening float", data.openingFloat], ["Opening cash counted", data.openingCash],
        ["Cash sales", data.cashSales], ["Cash expenses", -data.cashExpenses],
        ["Expected cash", data.expectedCash], ["Actual cash counted", data.actualCash],
        [data.cashDifference < 0 ? "Shortage" : "Surplus", Math.abs(data.cashDifference)],
      ].map(([label, value]) => h(View, { style: styles.row, key: String(label) },
        h(Text, { style: styles.grow }, String(label)), h(Text, null, money(Number(value))),
      )),
      h(Text, { style: styles.sectionTitle }, "Sales through the session"),
      ...data.hourlySales.map((item) => h(View, { style: styles.barRow, key: item.hour },
        h(View, { style: styles.barLabels }, h(Text, null, item.hour), h(Text, null, money(item.sales))),
        h(View, { style: styles.barTrack }, h(View, { style: [styles.bar, { width: `${Math.max(1, (item.sales / maxHourly) * 100)}%` }] })),
      )),
      h(Text, { style: styles.sectionTitle }, "Best-selling products"),
      ...(data.topProducts.length ? data.topProducts.map((item) => h(View, { style: styles.row, key: item.name },
        h(Text, { style: styles.grow }, `${item.name} · ${item.units} units`), h(Text, null, money(item.sales)),
      )) : [h(Text, { key: "none" }, "No completed product sales in this session.")]),
      data.closingNotes ? h(Text, { style: styles.note }, `Closing notes: ${data.closingNotes}`) : null,
      h(Text, { style: styles.footer }, "Generated from persisted Healthfield orders, payments, expenses and stock receipts. Times shown in Africa/Nairobi."),
    ),
  );
  return Buffer.from(await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]));
}
