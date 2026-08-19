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
  TriangleAlert,
  Users,
  Send,
} from "lucide-react";
import Link from "next/link";
type Row = {
  orderId: number;
  createdAt: string;
  status: string;
  branch: string | null;
  productName: string;
  quantity: number;
  lineTotal: string;
  category: string | null;
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
export function Dashboard({
  stats,
  analytics = [],
  recentOrders = [],
  variant = "admin",
  branchName,
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
  recentOrders?: Order[];
  variant?: "admin" | "staff";
  branchName?: string;
}) {
  const staff = variant === "staff";
  const base = staff ? "/staff" : "/admin";
  const [range, setRange] = useState<7 | 30 | 90>(7);
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
      bins = keys.map((x) => ({ ...x, sales: 0, orders: new Set<number>() })),
      cats = new Map<string, number>(),
      products = new Map<string, { sales: number; units: number }>(),
      attention = new Set<number>();
    for (const r of analytics) {
      const d = new Date(r.createdAt),
        key = range === 90 ? (()=>{const start=new Date(d);start.setDate(d.getDate()-d.getDay());return kenyaDateKey(start)})() : kenyaDateKey(d),
        bin = bins.find((x) => x.key === key);
      if (!bin) continue;
      const v = Number(r.lineTotal);
      bin.sales += v;
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
      orders = new Set(bins.flatMap((x) => [...x.orders]));
    return {
      bins,
      sales,
      orderCount: orders.size,
      attentionCount: attention.size,
      cats: [...cats].sort((a, b) => b[1] - a[1]),
      products: [...products]
        .sort((a, b) => b[1].sales - a[1].sales)
        .slice(0, 5),
    };
  }, [analytics, range]);
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
          <Chart bins={data.bins} />
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
      </section>
    </main>
  );
}
function Metric(p: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  href?: string;
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
}: {
  bins: { label: string; sales: number; orders: Set<number> }[];
}) {
  const [hover, setHover] = useState(0),
    [pointer, setPointer] = useState<{ x: number; y: number } | null>(null),
    max = Math.max(...bins.map((x) => x.sales), 1),
    omax = Math.max(...bins.map((x) => x.orders.size), 1),
    xy = (n: number, max: number, i: number) =>
      `${(i / Math.max(1, bins.length - 1)) * 100},${92 - (n / max) * 80}`,
    sales = bins.map((b, i) => xy(b.sales, max, i)).join(" "),
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
        <span>Profit needs product costs</span>
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
        <polyline className="orders" points={orders} />
      </svg>
      {pointer && <b className="chart-tip" style={{ left: pointer.x, top: pointer.y }}>
        {bins[hover].label}: {money(bins[hover].sales)} · {bins[hover].orders.size} orders
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
