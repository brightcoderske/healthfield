"use client";

import { ClipboardList, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { applicableOrderStatuses, type OrderFulfilmentMethod, type OrderStatus } from "@/lib/order-status-transitions";
import styles from "./order-list.module.css";

type Order = { id: number; orderNumber: string; customerName: string; phone: string; status: string; createdAt: string; paymentStatus: string; paymentMethod: string; paymentChannel: "ONLINE" | "POS" | null; amountPaid: string; fulfilmentMethod: OrderFulfilmentMethod; total: string; deliveryArea: string | null };
type OrderKind = "ALL" | "DELIVERY" | "PICKUP" | "POS";

const removable = new Set(["NEW", "CONFIRMED", "UNDER_REVIEW", "CANCELLED"]);
const allStatuses = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "UNDER_REVIEW", "BEING_FULFILLED", "PARTIALLY_READY", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"] as const;
const kinds: Array<{ value: OrderKind; label: string }> = [{ value: "ALL", label: "All orders" }, { value: "DELIVERY", label: "Delivery" }, { value: "PICKUP", label: "Pickup" }, { value: "POS", label: "POS sales" }];
const paymentName = (method: string) => method === "MPESA_EXPRESS" ? "M-Pesa Express" : method === "MANUAL_MPESA" ? "Manual M-Pesa" : "Cash";

function orderKind(order: Order): Exclude<OrderKind, "ALL"> {
  if (order.paymentChannel === "POS") return "POS";
  return order.fulfilmentMethod;
}

function statusesForKind(statuses: readonly string[], kind: OrderKind) {
  if (kind === "DELIVERY" || kind === "PICKUP") {
    const applicable = applicableOrderStatuses(kind);
    return statuses.filter((status) => applicable.includes(status as OrderStatus));
  }
  return statuses;
}

export function OrderList({ orders, statuses = allStatuses, filterKey = "healthfield-order-status-filters", pageSize, emptyHint, basePath = "/admin/orders", allowDelete = true }: { orders: Order[]; statuses?: readonly string[]; filterKey?: string; pageSize?: number; emptyHint?: string; basePath?: string; allowDelete?: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(orders);
  const [open, setOpen] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<OrderKind>("ALL");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(filterKey) || "[]");
        if (Array.isArray(saved)) setSelected(saved.filter((item: unknown): item is string => statuses.includes(item as string)));
        const savedKind = localStorage.getItem(`${filterKey}-type`) as OrderKind | null;
        if (savedKind && kinds.some((entry) => entry.value === savedKind)) setKind(savedKind);
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [filterKey, statuses]);

  const kindCounts = useMemo(() => Object.fromEntries(kinds.map((entry) => [entry.value, entry.value === "ALL" ? rows.length : rows.filter((order) => orderKind(order) === entry.value).length])), [rows]);
  const kindRows = useMemo(() => kind === "ALL" ? rows : rows.filter((order) => orderKind(order) === kind), [rows, kind]);
  const counts = useMemo(() => Object.fromEntries(statuses.map((status) => [status, kindRows.filter((order) => order.status === status).length])), [kindRows, statuses]);
  const visibleStatuses = useMemo(() => statusesForKind(statuses, kind).filter((status) => counts[status] > 0), [statuses, kind, counts]);
  const shown = useMemo(() => kindRows.filter((order) => (!selected.length || selected.includes(order.status)) && `${order.orderNumber} ${order.customerName} ${order.phone} ${order.paymentMethod} ${order.paymentStatus} ${orderKind(order)}`.toLowerCase().includes(q.toLowerCase())), [kindRows, selected, q]);
  const pageCount = pageSize ? Math.max(1, Math.ceil(shown.length / pageSize)) : 1;
  const current = Math.min(page, pageCount - 1);
  const visible = pageSize ? shown.slice(current * pageSize, current * pageSize + pageSize) : shown;

  function toggle(status: string) {
    setPage(0);
    setSelected((currentStatuses) => {
      const next = currentStatuses.includes(status) ? currentStatuses.filter((item) => item !== status) : [...currentStatuses, status];
      localStorage.setItem(filterKey, JSON.stringify(next));
      return next;
    });
  }

  function chooseKind(nextKind: OrderKind) {
    setPage(0);
    setKind(nextKind);
    localStorage.setItem(`${filterKey}-type`, nextKind);
    const allowed = statusesForKind(statuses, nextKind);
    setSelected((currentStatuses) => {
      const next = currentStatuses.filter((status) => allowed.includes(status));
      localStorage.setItem(filterKey, JSON.stringify(next));
      return next;
    });
  }

  function clearFilters() {
    setPage(0);
    setSelected([]);
    localStorage.removeItem(filterKey);
  }

  async function remove(order: Order) {
    if (!confirm(`Delete ${order.orderNumber}? This permanently removes the order and its items.`)) return;
    const response = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error || "Order could not be deleted.");
    setRows((currentRows) => currentRows.filter((value) => value.id !== order.id));
    setOpen(null);
    setMessage(`${order.orderNumber} deleted.`);
  }

  return <>
    <div className="compact-table-tools admin-data-tools"><label><Search/><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search order, customer, phone or payment"/></label><span>{shown.length} of {kindRows.length} records</span></div>
    <div className={styles.typeFilters}>{kinds.filter((entry) => entry.value === "ALL" || kindCounts[entry.value] > 0).map((entry) => <button type="button" key={entry.value} className={kind === entry.value ? styles.active : ""} onClick={() => chooseKind(entry.value)}>{entry.label}<b>{kindCounts[entry.value]}</b></button>)}</div>
    {visibleStatuses.length ? <div className={styles.filters}><button type="button" className={!selected.length ? styles.active : ""} onClick={clearFilters}>All statuses <b>{kindRows.length}</b></button>{visibleStatuses.map((status) => <label key={status}><input type="checkbox" checked={selected.includes(status)} onChange={() => toggle(status)}/><span>{status.replaceAll("_", " ")}</span><b>{counts[status]}</b></label>)}</div> : null}
    {message ? <div className="form-message">{message}</div> : null}
    <div className={styles.scroller}><section className={`admin-search-table ${styles.table}`} onClick={() => setOpen(null)}><div className="admin-search-head"><span>Order &amp; customer</span><span>Status</span><span>Payment</span><span>Fulfilment</span><span>Total</span><span>Actions</span></div>{visible.length ? visible.map((order) => {
      const rowKind = orderKind(order);
      const fulfilmentLabel = rowKind === "POS" ? "POS SALE" : rowKind;
      const fulfilmentDetail = rowKind === "DELIVERY" ? order.deliveryArea || "Customer delivery" : rowKind === "PICKUP" ? "Store pickup" : "Counter sale";
      return <article className={styles[rowKind.toLowerCase()]} key={order.id}><div><a className="row-link" href={`${basePath}/${order.id}`}>{order.orderNumber}</a><small>{order.customerName} · {order.phone}</small></div><div><strong>{order.status.replaceAll("_", " ")}</strong><small>{new Date(order.createdAt).toLocaleDateString()}</small></div><div><strong className={`payment-type payment-type-${order.paymentMethod.toLowerCase()}`}>{paymentName(order.paymentMethod)}</strong><small>{order.paymentStatus}</small></div><div><strong>{fulfilmentLabel}</strong><small>{fulfilmentDetail}</small></div><strong>KES {Number(order.total).toLocaleString()}</strong><div className={styles.actions}><button aria-label="Order actions" onClick={(event) => { event.stopPropagation(); setOpen(open === order.id ? null : order.id); }}><MoreHorizontal/></button>{open === order.id ? <div onClick={(event) => event.stopPropagation()}><a href={`${basePath}/${order.id}`}>Open order</a>{allowDelete && removable.has(order.status) ? <button onClick={() => remove(order)}><Trash2/> Delete order</button> : null}</div> : null}</div></article>;
    }) : <div className="database-empty"><ClipboardList/><strong>No matching orders</strong><span>{selected.length ? "Clear a status filter or search again." : emptyHint || "Try a different search."}</span></div>}</section></div>
    {pageSize && pageCount > 1 ? <div className={styles.pager}><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>← Previous</button><span>Page {current + 1} of {pageCount}</span><button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>Next →</button></div> : null}
  </>;
}
