"use client";
import { useMemo, useState } from "react";
import styles from "./dashboard.module.css";
import {
  BarChart3,
  ClipboardList,
  Pill,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Coins,
  TriangleAlert,
  Users,
  Send,
  Truck,
  Receipt,
  X,
} from "lucide-react";
import Link from "next/link";
import { summariseProfit } from "@/lib/profit";
import { parseVatRate, vatRateLabel } from "@/lib/vat";
import { useRouter } from "next/navigation";
type Row = {
  orderId: number;
  createdAt: string;
  status: string;
  branch: string | null;
  productName: string;
  quantity: number;
  lineTotal: string;
  category: string | null;
  /** Buying price captured when the line sold, and the product's cost today. */
  unitCost?: string | null;
  productCost?: string | null;
};
type Order = {
  id: number;
  orderNumber: string;
  customerName: string;
  status: string;
  total: string;
  createdAt: string;
};
const money = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kenyaDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
type DeliveryRow = {
  orderId: number;
  createdAt: string;
  deliveryFee: string;
  distanceKm: string | null;
  bandId: number | null;
  bandLabel: string | null;
  bandMinKm: string | null;
};

export function Dashboard({
  stats,
  analytics = [],
  deliveries = [],
  deliveryBands = [],
  recentOrders = [],
  vat,
  variant = "admin",
  branchName,
  role,
}: {
  name: string;
  stats: {
    newOrders: number;
    pendingPrescriptions: number;
    activeProducts: number;
    lowStock: number;
  sms?: { configured: boolean; promotionalReady: boolean; segments30Days: number; failed30Days: number };
    customers: number;
  };
  analytics?: Row[];
  deliveries?: DeliveryRow[];
  deliveryBands?: Array<{ id: number; label: string; minKm: string }>;
  recentOrders?: Order[];
  /** Optional: the API service deploys separately, so an older build omits it. */
  vat?: {
    enabled: boolean;
    rate: number;
    since?: string;
    collected?: number;
    orderCount?: number;
    orders?: Array<{ id: number; orderNumber: string; customerName: string; source: string; subtotal: number; vat: number; vatRate: number; total: number; branch: string | null; createdAt: string }>;
  };
  variant?: "admin" | "staff";
  branchName?: string;
  /** Profit is the owner's figure; only SUPER_ADMIN sees it. */
  role?: string;
}) {
  const staff = variant === "staff";
  const base = staff ? "/staff" : "/admin";
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const [sendingReport, setSendingReport] = useState(false);
  const [vatOpen, setVatOpen] = useState(false);
  const [remitting, setRemitting] = useState(false);
  const [remitNotice, setRemitNotice] = useState("");
  const router = useRouter();
  const [reportNotice, setReportNotice] = useState("");
  const data = useMemo(() => {
    const now = new Date(),
      keys =
        range === 90
          ? Array.from({ length: 13 }, (_, i) => {
              const d = new Date(now);
              d.setDate(now.getDate() - (12 - i) * 7);
              const weekStart = new Date(d);
              weekStart.setDate(d.getDate() - d.getDay());
              return {
                key: kenyaDateKey(weekStart),
                label: d.toLocaleDateString("en-KE", { month: "short", day: "numeric" }),
              };
            })
          : Array.from({ length: range }, (_, i) => {
              const d = new Date(now);
              d.setDate(now.getDate() - (range - 1 - i));
              return {
                key: kenyaDateKey(d),
                label: d.toLocaleDateString("en-KE", {
                  month: "short",
                  day: "numeric",
                }),
              };
            }),
      bins = keys.map((x) => ({ ...x, sales: 0, profit: 0, orders: new Set<number>() })),
      cats = new Map<string, number>();
    let estimatedSales = 0,
      unpricedSales = 0;
    const
      products = new Map<string, { sales: number; units: number }>(),
      attention = new Set<number>();
    for (const r of analytics) {
      const d = new Date(r.createdAt),
        key = range === 90 ? (()=>{const start=new Date(d);start.setDate(d.getDate()-d.getDay());return kenyaDateKey(start)})() : kenyaDateKey(d),
        bin = bins.find((x) => x.key === key);
      if (!bin) continue;
      const v = Number(r.lineTotal);
      bin.sales += v;
      // One line at a time, by the same rules the reports use: a line with no cost
      // anywhere is left out of profit rather than counted as all margin.
      const line = summariseProfit([r]);
      bin.profit += line.profit;
      estimatedSales += line.estimatedSales;
      unpricedSales += line.unpricedSales;
      bin.orders.add(r.orderId);
      if (r.status === "NEW") attention.add(r.orderId);
      cats.set(
        r.category || "Uncategorised",
        (cats.get(r.category || "Uncategorised") || 0) + v,
      );
      const p = products.get(r.productName) || { sales: 0, units: 0 };
      p.sales += v;
      p.units += r.quantity;
      products.set(r.productName, p);
    }
    const sales = bins.reduce((n, x) => n + x.sales, 0),
      profit = bins.reduce((n, x) => n + x.profit, 0),
      orders = new Set(bins.flatMap((x) => [...x.orders]));
    return {
      bins,
      sales,
      profit,
      estimatedSales,
      unpricedSales,
      orderCount: orders.size,
      attentionCount: attention.size,
      cats: [...cats].sort((a, b) => b[1] - a[1]),
      products: [...products]
        .sort((a, b) => b[1].sales - a[1].sales)
        .slice(0, 5),
    };
  }, [analytics, range]);

  // Delivery income is deliberately kept out of "Sales value": folding a carriage
  // charge into product revenue would inflate it and distort average order value and
  // best sellers. It is counted per order, never per item, because one order carries
  // one delivery fee however many things are in the basket.
  const vatRate = parseVatRate(vat?.rate);
  const vatOrders = vat?.orders ?? [];
  const vatCollected = vat?.collected ?? 0;

  // Recording a remittance is what returns the running figure to zero; the orders the
  // tax came from are never touched.
  async function recordRemittance() {
    if (remitting) return;
    setRemitting(true);
    setRemitNotice("");
    const response = await fetch("/api/vat/remittances", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    if (!response?.ok) setRemitNotice(body?.error || "The remittance could not be recorded.");
    else { setVatOpen(false); router.refresh(); }
    setRemitting(false);
  }

  const delivery = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (range - 1));
    cutoff.setHours(0, 0, 0, 0);
    const rows = (deliveries ?? []).filter((row) => new Date(row.createdAt) >= cutoff);
    const bands = new Map<string, { key: string; label: string; income: number; count: number; free: number; order: number }>();
    for (const band of deliveryBands) {
      bands.set(`b${band.id}`, { key: `b${band.id}`, label: band.label, income: 0, count: 0, free: 0, order: Number(band.minKm) });
    }
    let income = 0, free = 0;
    for (const row of rows) {
      const fee = Number(row.deliveryFee) || 0;
      income += fee;
      if (fee === 0) free += 1;
      // Orders priced before distance bands existed, or by the flat fallback, have no
      // band. They are still income, so they are shown rather than silently dropped.
      // Orders keep the band id they were priced by, so they land on the right row even
      // if the label has since been renamed. Unbanded orders share one synthetic row.
      const key = row.bandId ? `b${row.bandId}` : "flat";
      const label = row.bandLabel ?? "No band (flat rate)";
      const entry = bands.get(key) ?? { key, label, income: 0, count: 0, free: 0, order: Number(row.bandMinKm ?? 9999) };
      entry.income += fee;
      entry.count += 1;
      if (fee === 0) entry.free += 1;
      bands.set(key, entry);
    }
    return {
      income,
      count: rows.length,
      free,
      bands: [...bands.values()].sort((a, b) => a.order - b.order || b.income - a.income),
    };
  }, [deliveries, deliveryBands, range]);
  return (
    <main className={`dashboard-page ${styles.root}`}>
      <header className="dashboard-top">
        <div>
          <span>{staff ? `${branchName || "Assigned shop"} operations` : "Healthfield administration"}</span>
          <h1>Dashboard</h1>
        </div>
        <div className="dashboard-ranges">
          {(
            [
              [7, "Weekly"],
              [30, "Monthly"],
              [90, "Quarterly"],
            ] as const
          ).map(([v, l]) => (
            <button
              className={range === v ? "active" : ""}
              onClick={() => setRange(v)}
              key={v}
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <section className="dashboard-metrics">
        <Metric
          icon={<TrendingUp />}
          label="Sales value"
          value={money(data.sales)}
          note={`${data.orderCount} orders in range`}
        />
        {role === "SUPER_ADMIN" ? (
          <Metric
            icon={<Coins />}
            label="Profit"
            value={money(data.profit)}
            note={data.unpricedSales > 0
              ? `${money(data.unpricedSales)} of sales has no buying price yet`
              : data.estimatedSales > 0
                ? `${money(data.estimatedSales)} used an estimated buying price`
                : `${data.sales > 0 ? Math.round((data.profit / data.sales) * 100) : 0}% margin in range`}
          />
        ) : null}
        <Metric
          icon={<ShoppingBag />}
          label="Orders"
          value={`${data.orderCount}`}
          note={`${data.attentionCount} need attention in range`}
        />
        <Metric
          icon={<BarChart3 />}
          label="Average order"
          value={money(data.orderCount ? data.sales / data.orderCount : 0)}
          note="Based on order items"
        />
        <Metric
          icon={staff ? <Pill /> : <Users />}
          label={staff ? "Shop products" : "Customers"}
          value={`${staff ? stats.activeProducts : stats.customers}`}
          note={staff ? "Active inventory records" : "Registered accounts"}
        />
        <Metric
          icon={<TriangleAlert />}
          label="Low stock"
          value={`${stats.lowStock}`}
          note={staff ? branchName || "Assigned shop" : "Branch records"}
        />
        {!staff ? (
          <Metric
            icon={<Truck />}
            label="Delivery income"
            value={money(delivery.income)}
            note={
              delivery.count
                ? `${delivery.count} deliveries${delivery.free ? `, ${delivery.free} free` : ""} in range`
                : "No deliveries in range"
            }
          />
        ) : null}
        {!staff ? (
          <Metric
            icon={<Receipt />}
            label="VAT to remit"
            value={money(vatCollected)}
            note={
              !vatRate
                ? "Set a VAT rate in settings to charge it"
                : vatOrders.length
                  ? `${vatOrders.length} sales since the last remittance · tap for the list`
                  : "No VAT charged since the last remittance"
            }
            onClick={vatOrders.length ? () => setVatOpen(true) : undefined}
          />
        ) : null}
        {!staff && stats.sms ? (
          <Metric
            icon={<Send />}
            label="Bulk SMS"
            href="/admin/sms"
            value={
              stats.sms.configured
                ? `${stats.sms.segments30Days.toLocaleString()} sent`
                : "Not set up"
            }
            note={
              !stats.sms.configured
                ? "Add Celcom credentials to start"
                : stats.sms.failed30Days
                  ? `${stats.sms.failed30Days} failed in 30 days — open reports`
                  : "Segments in the last 30 days"
            }
          />
        ) : null}
      </section>
      <section className="dashboard-grid main">
        <article className="dashboard-card sales-chart">
          <Card
            title="Sales overview"
            text={
              range === 7
                ? "Last 7 days"
                : range === 30
                  ? "Last 30 days"
                  : "Last 90 days"
            }
          />
          <Chart bins={data.bins} showProfit={role === "SUPER_ADMIN" && data.profit > 0} />
          {role === "SUPER_ADMIN" ? <div className="report-send">
            <button type="button" disabled={sendingReport} onClick={async () => {
              // The nightly email is unattended; this is how you see the real thing
              // before eleven, built from today's real figures.
              setSendingReport(true);
              setReportNotice("");
              const response = await fetch("/api/reports/daily", { method: "POST" }).catch(() => null);
              const body = await response?.json().catch(() => ({}));
              setReportNotice(body?.message || body?.error || "The report could not be sent.");
              setSendingReport(false);
            }}>{sendingReport ? "Sending…" : "Email today's report"}</button>
            {reportNotice ? <small role="status">{reportNotice}</small> : null}
          </div> : null}
        </article>
        <article className="dashboard-card">
          <Card title="Sales by category" text="Hover a segment for revenue" />
          <Donut items={data.cats} />
        </article>
        <article className="dashboard-card">
          <Card title="Best sellers" text="By sales value" />
          <ol className="best-sellers">
            {data.products.map(([n, v]) => (
              <li key={n}>
                <span>
                  {n}
                  <small>{v.units} units</small>
                </span>
                <b>{money(v.sales)}</b>
              </li>
            ))}
          </ol>
        </article>
      </section>
      <section className="dashboard-grid bottom">
        <article className="dashboard-card">
          <Card title="Recent orders" text={staff ? "Shared order queue across all shops" : "Latest customer activity"} />
          <div className="dashboard-orders">
            {recentOrders.map((o) => (
              <Link href={`${base}/orders/${o.id}`} key={o.id}>
                <span>
                  <b>{o.orderNumber}</b>
                  <small>{o.customerName}</small>
                </span>
                <em>{o.status.replaceAll("_", " ")}</em>
                <strong>{money(Number(o.total))}</strong>
              </Link>
            ))}
          </div>
        </article>
        <article className="dashboard-card dashboard-alerts">
          <Card title="Action centre" text="Operational queue" />
          <Link href={`${base}/orders`}>
            <ClipboardList />
            <span>
              <b>{stats.newOrders} new orders</b>
              <small>Review and assign stock</small>
            </span>
          </Link>
          <Link href={`${base}/prescriptions`}>
            <ShieldCheck />
            <span>
              <b>{stats.pendingPrescriptions} prescriptions</b>
              <small>Awaiting pharmacist review</small>
            </span>
          </Link>
          <Link href={staff ? "/staff/inventory" : "/admin/products"}>
            {staff ? <TriangleAlert /> : <Pill />}
            <span>
              <b>{staff ? `${stats.lowStock} low-stock records` : `${stats.activeProducts} active products`}</b>
              <small>{staff ? `Manage stock at ${branchName || "your shop"}` : "Manage catalogue and pricing"}</small>
            </span>
          </Link>
        </article>
        {!staff ? (
        <article className="dashboard-card delivery-bands-card">
          <Card title="Delivery income by band" text="What each distance band collected in range" />
          {delivery.bands.length ? (
            <ul className="delivery-band-breakdown">
              {delivery.bands.map((band) => (
                <li key={band.key}>
                  <span>
                    <strong>{band.label}</strong>
                    <small>
                      {band.count} {band.count === 1 ? "delivery" : "deliveries"}
                      {band.free ? ` · ${band.free} free` : ""}
                    </small>
                  </span>
                  <b>{money(band.income)}</b>
                  {/* Share of delivery income, so a band that carries the cost is
                      obvious next to one that barely registers. */}
                  <i style={{ width: `${delivery.income ? Math.round((band.income / delivery.income) * 100) : 0}%` }} aria-hidden="true" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="delivery-band-empty">No distance bands configured yet.</p>
          )}
          <footer className="delivery-band-footer">
            Rider and courier costs are not recorded yet, so this is income, not margin.
          </footer>
        </article>
        ) : null}
      </section>
      {vatOpen ? (
        <div className="vat-overlay" role="dialog" aria-modal="true" aria-label="VAT to remit" onClick={() => setVatOpen(false)}>
          <section className="vat-sheet" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>VAT to remit</h2>
                <p>
                  {money(vatCollected)} on {vatOrders.length} {vatOrders.length === 1 ? "sale" : "sales"}
                  {vat?.since && !vat.since.startsWith("1970") ? ` since ${new Date(vat.since).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric" })}` : " since the shop opened"}
                </p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setVatOpen(false)}><X /></button>
            </header>
            <div className="vat-scroll">
              <table className="vat-table">
                <thead>
                  <tr><th>Order</th><th>Date</th><th>Source</th><th>Net</th><th>VAT</th></tr>
                </thead>
                <tbody>
                  {vatOrders.map((row) => (
                    <tr key={row.id}>
                      <td><Link href={`${base}/orders/${row.id}`}>{row.orderNumber}</Link><small>{row.customerName}</small></td>
                      <td>{new Date(row.createdAt).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", month: "short", day: "numeric" })}</td>
                      <td>{row.source}{row.branch ? ` · ${row.branch}` : ""}</td>
                      <td>{money(row.subtotal)}</td>
                      <td><b>{money(row.vat)}</b><small>{vatRateLabel(row.vatRate)}</small></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>Total to remit</td><td><b>{money(vatCollected)}</b></td></tr>
                </tfoot>
              </table>
            </div>
            <footer className="vat-foot">
              {remitNotice ? <p className="vat-notice">{remitNotice}</p> : null}
              <span>Recording a remittance starts the next period from zero. The orders above are never changed.</span>
              <button type="button" disabled={remitting || vatCollected <= 0} onClick={recordRemittance}>
                {remitting ? "Recording…" : `Mark ${money(vatCollected)} paid to KRA`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
function Metric(p: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span>{p.icon}</span>
      <div>
        <small>{p.label}</small>
        <strong>{p.value}</strong>
        <em>{p.note}</em>
      </div>
    </>
  );
  // A card with somewhere to go becomes the link itself, so the whole tile is the
  // target rather than a small chevron in its corner.
  if (p.href) {
    return (
      <Link className="metric-link" href={p.href}>
        {body}
      </Link>
    );
  }
  if (p.onClick) {
    return (
      <button type="button" className="metric-link metric-button" onClick={p.onClick}>
        {body}
      </button>
    );
  }
  return (
    <article>
      {body}
    </article>
  );
}
function Card(p: { title: string; text: string }) {
  return (
    <header>
      <div>
        <h2>{p.title}</h2>
        <p>{p.text}</p>
      </div>
    </header>
  );
}
function Chart({
  bins,
  showProfit = false,
}: {
  bins: { label: string; sales: number; profit: number; orders: Set<number> }[];
  showProfit?: boolean;
}) {
  const [hover, setHover] = useState(0),
    [pointer, setPointer] = useState<{ x: number; y: number } | null>(null),
    max = Math.max(...bins.map((x) => x.sales), 1),
    omax = Math.max(...bins.map((x) => x.orders.size), 1),
    xy = (n: number, max: number, i: number) =>
      `${(i / Math.max(1, bins.length - 1)) * 100},${92 - (n / max) * 80}`,
    sales = bins.map((b, i) => xy(b.sales, max, i)).join(" "),
    // Profit shares the sales axis deliberately: the distance between the two lines is
    // the cost of goods, which is the thing worth seeing.
    profit = bins.map((b, i) => xy(b.profit, max, i)).join(" "),
    orders = bins.map((b, i) => xy(b.orders.size, omax, i)).join(" ");
  return (
    <div className="line-chart">
      <div className="chart-legend">
        <span>
          <i />
          Sales
        </span>
        <span>
          <i />
          Orders
        </span>
        {showProfit ? <span className="profit-key"><i />Profit</span> : <span>Profit needs product costs</span>}
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPointer({ x: e.clientX + 14, y: e.clientY - 14 });
          setHover(
            Math.min(
              bins.length - 1,
              Math.max(
                0,
                Math.round(
                  ((e.clientX - r.left) / r.width) * (bins.length - 1),
                ),
              ),
            ),
          );
        }}
        onMouseLeave={() => setPointer(null)}
      >
        {[20, 45, 70].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} />
        ))}
        <polyline points={sales} />
        {showProfit ? <polyline className="profit" points={profit} /> : null}
        <polyline className="orders" points={orders} />
      </svg>
      {pointer && <b className="chart-tip" style={{ left: pointer.x, top: pointer.y }}>
        {bins[hover].label}: {money(bins[hover].sales)} · {bins[hover].orders.size} orders{showProfit ? ` · profit ${money(bins[hover].profit)}` : ""}
      </b>}
      <div className="chart-labels">
        {bins.map((b) => (
          <small key={b.label}>{b.label}</small>
        ))}
      </div>
    </div>
  );
}
function Donut({ items }: { items: [string, number][] }) {
  const [hover, setHover] = useState(0),
    [pointer, setPointer] = useState<{ x: number; y: number } | null>(null),
    total = items.reduce((n, x) => n + x[1], 0) || 1,
    colors = ["#722581", "#d0378d", "#2163d8", "#15a36e", "#f09b19"];
  return (
    <div className="donut-wrap">
      <div style={{ position: "relative", flex: "none" }}>
        <svg
          viewBox="0 0 42 42"
          className="donut"
          onMouseLeave={() => setPointer(null)}
        >
          {items.map(([n, v], i) => {
            const d = (v / total) * 100,
              offset = items.slice(0, i).reduce((sum, item) => sum + (item[1] / total) * 100, 0),
              node = (
                <circle
                  key={n}
                  cx="21"
                  cy="21"
                  r="15.9"
                  fill="none"
                  stroke={colors[i % colors.length]}
                  strokeWidth="7"
                  strokeDasharray={`${d} ${100 - d}`}
                  strokeDashoffset={-offset}
                  onMouseMove={(event) => {
                    const box =
                      event.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover(i);
                    setPointer({
                      x: event.clientX - box.left,
                      y: event.clientY - box.top,
                    });
                  }}
                />
              );
            return node;
          })}
          <text
            x="21"
            y="21"
            textAnchor="middle"
            textLength="20"
            lengthAdjust="spacingAndGlyphs"
          >
            {money(items[hover]?.[1] || 0)}
          </text>
        </svg>
        {pointer && (
          <b
            style={{
              position: "absolute",
              left: pointer.x,
              top: pointer.y,
              transform: "translate(-50%,-125%)",
              zIndex: 2,
              pointerEvents: "none",
              whiteSpace: "nowrap",
              padding: "4px 6px",
              borderRadius: 5,
              color: "#fff",
              background: "#392143",
              fontSize: 9,
            }}
          >
            {items[hover][0]}: {money(items[hover][1])}
          </b>
        )}
      </div>
      <div className="donut-legend">
        {items.map(([n, v], i) => (
          <span key={n} onMouseEnter={() => setHover(i)}>
            <i style={{ background: colors[i % colors.length] }} />
            <strong>{n}</strong>
            <b>{money(v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
