"use client";

import { ChevronLeft, ChevronRight, CornerDownRight, FolderTree, Save, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { marginPercent, sellingPriceFromCost } from "@/lib/profit";

export type BulkProduct = {
  id: number;
  categoryId: number;
  name: string;
  brand: string | null;
  price: number;
  discountPrice: number | null;
  costPrice: string | number | null;
  isActive: boolean;
  // An option is a product row that belongs under another one, so the table lists it as
  // a branch of its product rather than as a product of its own.
  groupName?: string | null;
  variantOf?: number | null;
  variantLabel?: string | null;
  variantOrder?: number | null;
};

export type BulkBranch = { id: number; name: string };
export type BulkStock = { branchId: number; productId: number; quantityAvailable: number; reorderLevel: number };

/** What one row can carry. Absent keys mean "unchanged", which is what gets sent. */
type RowEdit = { name?: string; costPrice?: string; sellingPrice?: string; crossedPrice?: string; stock?: Record<number, string> };

const PAGE_SIZE = 100;
const FILTER_KEY = "healthfield:products:bulk-filter";

/** The search and category last worked with. A corrupt entry is not worth a crash. */
function storedFilter(): { query: string; category: string } {
  if (typeof window === "undefined") return { query: "", category: "all" };
  try {
    const stored = JSON.parse(window.localStorage.getItem(FILTER_KEY) || "{}") as { query?: string; category?: string };
    return { query: String(stored.query || ""), category: String(stored.category || "all") };
  } catch {
    return { query: "", category: "all" };
  }
}

/**
 * The whole catalogue, editable in place.
 *
 * The single-product modal is right for one product and wrong for forty: a price round
 * across the shelf meant forty modals, each with its own save and its own chance of
 * being the one that failed. Here every field is a cell, only edited cells are sent,
 * and the save is one transaction — so a page either lands whole or not at all.
 *
 * Filters live in local storage rather than component state alone, because the reason
 * anyone opens this screen is to work through a list, and a save that dropped you back
 * to page one of an unfiltered catalogue would undo the work of finding your place.
 */
export function BulkEditor({
  products,
  categories,
  branches,
  stock,
  onClose,
  registerClose,
  onSaved,
}: {
  products: BulkProduct[];
  categories: Array<{ id: number; name: string }>;
  branches: BulkBranch[];
  stock: BulkStock[];
  onClose: () => void;
  /** Hands the parent a guarded close, so its toggle asks about unsaved work too. */
  registerClose?: (close: () => void) => void;
  onSaved: (rows: Array<{ id: number; name: string; price: number; discountPrice: number | null; costPrice: string | null; stock: Array<{ branchId: number; quantityAvailable: number }> }>) => void;
}) {
  // Read straight into the initial state rather than restored by an effect: this
  // component only ever mounts after a click, so there is no server render to differ
  // from and no first paint showing the wrong list.
  const [query, setQuery] = useState(() => storedFilter().query);
  const [category, setCategory] = useState(() => storedFilter().category);
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(FILTER_KEY, JSON.stringify({ query, category })); } catch { /* private mode */ }
  }, [query, category]);

  const held = useMemo(() => {
    const map = new Map<string, BulkStock>();
    for (const row of stock) map.set(`${row.productId}:${row.branchId}`, row);
    return map;
  }, [stock]);

  // Products with their options beneath them. Filtering and paging work on the product,
  // so a page of twenty-five is twenty-five products — pricing a bag means seeing all of
  // its colours together, not meeting them scattered through an alphabetical list.
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = (product: BulkProduct) =>
      (category === "all" || product.categoryId === Number(category)) &&
      (!term || `${product.groupName || ""} ${product.name} ${product.brand || ""}`.toLowerCase().includes(term));
    const byLead = new Map<number, { lead: BulkProduct; children: BulkProduct[] }>();
    for (const product of products) {
      const leadId = product.variantOf ?? product.id;
      let entry = byLead.get(leadId);
      if (!entry) {
        entry = { lead: product, children: [] };
        byLead.set(leadId, entry);
      }
      if (product.id === leadId) entry.lead = product;
      else entry.children.push(product);
    }
    return [...byLead.values()]
      .filter((entry) => [entry.lead, ...entry.children].some(matches))
      .map((entry) => ({
        ...entry,
        children: [...entry.children].sort(
          (first, second) => (first.variantOrder ?? 0) - (second.variantOrder ?? 0) || first.id - second.id,
        ),
      }))
      .sort((first, second) =>
        (first.lead.groupName || first.lead.name).localeCompare(second.lead.groupName || second.lead.name, "en"),
      );
  }, [products, query, category]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const dirtyIds = Object.keys(edits).map(Number);

  function edit(id: number, change: RowEdit) {
    setEdits((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  }

  /** Current value of a cell: what was typed, else what the product holds. */
  function value(product: BulkProduct, field: "name" | "costPrice" | "sellingPrice" | "crossedPrice") {
    const edited = edits[product.id]?.[field];
    if (edited !== undefined) return edited;
    if (field === "name") return product.name;
    if (field === "costPrice") return product.costPrice === null || product.costPrice === undefined ? "" : String(product.costPrice);
    if (field === "crossedPrice") return String(product.price);
    // What the customer actually pays: the discounted price when there is one.
    return String(product.discountPrice ?? product.price);
  }

  function stockValue(product: BulkProduct, branchId: number) {
    const edited = edits[product.id]?.stock?.[branchId];
    if (edited !== undefined) return edited;
    const row = held.get(`${product.id}:${branchId}`);
    return row ? String(row.quantityAvailable) : "";
  }

  /** Typing a buying price prices the row, exactly as the single-product form does. */
  function priceFromCost(product: BulkProduct, entered: string) {
    const selling = sellingPriceFromCost(entered);
    if (selling === null) return edit(product.id, { costPrice: entered });
    const crossed = Number(value(product, "crossedPrice"));
    edit(product.id, {
      costPrice: entered,
      sellingPrice: selling.toFixed(2),
      ...(Number.isFinite(crossed) && crossed >= selling ? {} : { crossedPrice: selling.toFixed(2) }),
    });
  }

  async function save() {
    const rows = dirtyIds.flatMap((id) => {
      const product = products.find((entry) => entry.id === id);
      const change = edits[id];
      if (!product || !change) return [];
      const stockRows = Object.entries(change.stock || {})
        .filter(([, quantity]) => quantity !== "" && Number.isFinite(Number(quantity)))
        .map(([branchId, quantity]) => ({ branchId: Number(branchId), quantityAvailable: Math.max(0, Math.trunc(Number(quantity))) }));
      return [{
        id,
        ...(change.name !== undefined ? { name: change.name.trim() } : {}),
        ...(change.costPrice !== undefined ? { costPrice: change.costPrice === "" ? null : Number(change.costPrice) } : {}),
        ...(change.crossedPrice !== undefined ? { price: Number(change.crossedPrice) } : {}),
        ...(change.sellingPrice !== undefined ? { discountPrice: change.sellingPrice === "" ? null : Number(change.sellingPrice) } : {}),
        ...(stockRows.length ? { stock: stockRows } : {}),
      }];
    });
    if (!rows.length) { setMessage("Nothing has been changed yet."); return false; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "The changes could not be saved."); return false; }
      // Nothing was written unless everything was, so the screen can safely adopt the
      // figures it just sent rather than reloading the whole catalogue.
      onSaved(rows.map((row) => {
        const product = products.find((entry) => entry.id === row.id)!;
        const price = row.price ?? product.price;
        const selling = row.discountPrice === undefined ? product.discountPrice : row.discountPrice;
        return {
          id: row.id,
          name: row.name ?? product.name,
          price,
          discountPrice: selling === null || selling === price ? null : selling,
          costPrice: row.costPrice === undefined ? (product.costPrice === null || product.costPrice === undefined ? null : String(product.costPrice)) : row.costPrice === null ? null : row.costPrice.toFixed(2),
          stock: row.stock ?? [],
        };
      }));
      setEdits({});
      setMessage(`${data.updated} product${data.updated === 1 ? "" : "s"} saved.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error && error.name === "TimeoutError"
        ? "Saving timed out. Nothing was changed — check the connection and press save again."
        : "Could not reach the server. Nothing was changed — press save again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Closing with work in progress asks first.
   *
   * The same toggle opens and closes this screen, so it is easy to press twice without
   * meaning to. Losing an afternoon of typed prices to a stray click is not a fair
   * price for a tidy toggle.
   */
  const requestClose = useCallback(() => {
    if (!Object.keys(edits).length) return onClose();
    setConfirmingClose(true);
  }, [edits, onClose]);
  useEffect(() => { registerClose?.(requestClose); }, [registerClose, requestClose]);

  return <section className="bulk-editor">
    <header>
      <div>
        <h2>Bulk edit</h2>
        <p>Every field is editable here. Only the cells you change are saved, and the whole save lands together or not at all.</p>
      </div>
      <div className="bulk-actions">
        <button type="button" className="bulk-save" disabled={saving || !dirtyIds.length} onClick={save}>
          <Save/>{saving ? "Saving…" : dirtyIds.length ? `Save ${dirtyIds.length} changed` : "Save"}
        </button>
        <button type="button" className="bulk-close" onClick={requestClose} aria-label="Close bulk edit"><X/></button>
      </div>
    </header>

    <div className="compact-table-tools">
      <label><Search/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search by name or brand"/></label>
      <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
        <option value="all">All categories</option>
        {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <span>{filtered.length} products · A to Z</span>
    </div>
    {message ? <p className={message.includes("saved") ? "bulk-message ok" : "bulk-message"} role="status">{message}</p> : null}
    {confirmingClose ? <div className="bulk-confirm" role="alertdialog" aria-label="Unsaved changes">
      <strong>{dirtyIds.length} product{dirtyIds.length === 1 ? " has" : "s have"} unsaved changes.</strong>
      <button type="button" className="bulk-save" disabled={saving} onClick={async () => { if (await save()) { setConfirmingClose(false); onClose(); } }}>{saving ? "Saving…" : "Save and close"}</button>
      <button type="button" onClick={() => { setEdits({}); setConfirmingClose(false); onClose(); }}>Discard and close</button>
      <button type="button" onClick={() => setConfirmingClose(false)}>Keep editing</button>
    </div> : null}

    <div className="bulk-table-scroller">
      <table className="bulk-table">
        <thead>
          <tr>
            <th className="bulk-name">Product</th>
            <th>Buying</th>
            <th>Selling</th>
            <th>Crossed out</th>
            {branches.map((branch) => <th key={branch.id}>{branch.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.flatMap((group) => {
            const hasOptions = group.children.length > 0;
            const options = [group.lead, ...group.children];
            // A product with options is a heading with its options beneath it. The lead is
            // one of the options — it is the blue bag, not the bag — so it is listed with
            // the rest rather than standing in for the product.
            const heading = hasOptions ? [
              <tr key={`group-${group.lead.id}`} className="is-product">
                <td className="bulk-name">
                  <FolderTree className="tree-branch" aria-hidden="true"/>
                  <span className="bulk-group-name">
                    <b>{group.lead.groupName || group.lead.name}</b>
                    <small>{group.lead.brand || "No brand"} · {options.length} options</small>
                  </span>
                </td>
                <td colSpan={3 + branches.length} className="bulk-group-note">Priced per option below</td>
              </tr>,
            ] : [];
            return [...heading, ...(hasOptions ? options : [group.lead]).map((product) => {
            const margin = marginPercent(value(product, "costPrice"), value(product, "sellingPrice"));
            const isOption = hasOptions;
            return <tr key={product.id} className={`${edits[product.id] ? "is-edited" : ""}${isOption ? " is-option" : ""}`.trim() || undefined}>
              <td className="bulk-name">
                {isOption ? <CornerDownRight className="tree-branch" aria-hidden="true"/> : null}
                {isOption ? (
                  // The stored name of an option is "{product} — {label}", and that is what
                  // a basket and a past order line show. Renaming it belongs in the
                  // product's own options table, where the label is what gets typed.
                  <span className="bulk-option-name" title="Rename this option in the product's Options table">
                    {product.variantLabel || product.name}
                  </span>
                ) : (
                  <input aria-label={`Name of ${product.name}`} value={value(product, "name")} onChange={(event) => edit(product.id, { name: event.target.value })}/>
                )}
                <small>{isOption
                  ? `Option of ${group.lead.groupName || group.lead.name}${margin !== null ? ` · ${margin}% margin` : ""}${product.isActive ? "" : " · inactive"}`
                  : `${product.brand || "No brand"}${margin !== null ? ` · ${margin}% margin` : ""}${product.isActive ? "" : " · inactive"}`}</small>
              </td>
              <td><input type="number" min="0" step=".01" inputMode="decimal" aria-label={`Buying price of ${product.name}`}
                value={value(product, "costPrice")} onChange={(event) => priceFromCost(product, event.target.value)}/></td>
              <td><input type="number" min="0" step=".01" inputMode="decimal" aria-label={`Selling price of ${product.name}`}
                value={value(product, "sellingPrice")} onChange={(event) => edit(product.id, { sellingPrice: event.target.value })}/></td>
              <td><input type="number" min="0" step=".01" inputMode="decimal" aria-label={`Crossed-out price of ${product.name}`}
                value={value(product, "crossedPrice")} onChange={(event) => edit(product.id, { crossedPrice: event.target.value })}/></td>
              {branches.map((branch) => <td key={branch.id}>
                <input type="number" min="0" step="1" inputMode="numeric" aria-label={`${branch.name} stock of ${product.name}`}
                  value={stockValue(product, branch.id)}
                  onChange={(event) => edit(product.id, { stock: { ...edits[product.id]?.stock, [branch.id]: event.target.value } })}/>
              </td>)}
            </tr>;
          })];
          })}
        </tbody>
      </table>
      {!visible.length ? <div className="database-empty"><strong>No matching products</strong><span>Try another search or category.</span></div> : null}
    </div>

    <nav className="compact-pagination" aria-label="Bulk edit pages">
      <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}><ChevronLeft/> Previous</button>
      <span>Page <strong>{currentPage}</strong> of {pageCount} · showing {visible.length} of {filtered.length}{dirtyIds.length ? ` · ${dirtyIds.length} unsaved` : ""}</span>
      <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount}>Next <ChevronRight/></button>
    </nav>
  </section>;
}
