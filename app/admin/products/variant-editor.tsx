"use client";

import { Layers, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export type VariantProduct = {
  id: number;
  name: string;
  groupName?: string | null;
  variantOf?: number | null;
  variantLabel?: string | null;
  variantName?: string | null;
  variantOrder?: number | null;
  price: number;
  discountPrice: number | null;
  barcode: string | null;
  packSize: string | null;
  isActive: boolean;
  /** Present on rows returned by the options endpoint, so a merge never drops them. */
  conditionIds?: number[];
};

type Row = {
  id?: number;
  label: string;
  price: string;
  discountPrice: string;
  barcode: string;
  packSize: string;
  isActive: boolean;
};

const blankRow = (): Row => ({ label: "", price: "", discountPrice: "", barcode: "", packSize: "", isActive: true });

function rowFrom(product: VariantProduct): Row {
  return {
    id: product.id,
    label: product.variantLabel || "",
    price: String(product.price ?? ""),
    discountPrice: product.discountPrice === null ? "" : String(product.discountPrice),
    barcode: product.barcode || "",
    packSize: product.packSize || "",
    isActive: product.isActive,
  };
}

/**
 * The list of things a product actually comes in: Blue/Red/Green, 100/200/500 ml.
 *
 * Each row is a real product row on save — its own barcode at the till, its own buying
 * price, its own count on the shelf — because that is what an option is in a shop. The
 * first row is this product itself, so it keeps its id, its stock and every order that
 * already points at it; only its name gains the label.
 *
 * Removing a row switches that option off rather than deleting it. It is still what last
 * month's order line points at.
 */
export function VariantEditor({
  product,
  siblings,
  onSaved,
}: {
  product: VariantProduct;
  /** Every row already in this product's group, this product included. */
  siblings: VariantProduct[];
  onSaved: (products: VariantProduct[]) => void;
}) {
  const leadId = product.variantOf ?? product.id;
  const existing = useMemo(
    () => [...siblings].sort((left, right) => {
      // The lead always leads: it is the row that keeps the history.
      if (left.id === leadId) return -1;
      if (right.id === leadId) return 1;
      return (left.variantOrder ?? 0) - (right.variantOrder ?? 0) || left.id - right.id;
    }),
    [siblings, leadId],
  );
  const hasList = existing.length > 1;
  const [open, setOpen] = useState(hasList);
  const [optionName, setOptionName] = useState(
    existing.find((item) => item.variantName)?.variantName || "",
  );
  const [rows, setRows] = useState<Row[]>(() =>
    hasList ? existing.map(rowFrom) : [{ ...rowFrom(product), label: product.variantLabel || "" }, blankRow()],
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    const filled = rows.filter((row) => row.label.trim() || row.id);
    if (filled.length === 1) {
      setMessage("A list needs at least two options. Add another, or remove this one to go back to a single product.");
      return;
    }
    const missingPrice = filled.find((row) => !row.price.trim() || !Number.isFinite(Number(row.price)));
    if (missingPrice) {
      setMessage(`Give "${missingPrice.label || "every option"}" a price.`);
      return;
    }
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/products/${leadId}/variants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        optionName: optionName.trim() || undefined,
        variants: filled.map((row) => ({
          id: row.id,
          label: row.label.trim(),
          price: Number(row.price),
          discountPrice: row.discountPrice.trim() ? Number(row.discountPrice) : null,
          barcode: row.barcode.trim() || null,
          packSize: row.packSize.trim() || null,
          isActive: row.isActive,
        })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setMessage(data.error || "Options could not be saved.");
    const saved: VariantProduct[] = data.products || [];
    setRows(saved.map(rowFrom));
    onSaved(saved);
    setMessage(`Saved. This product now comes in ${saved.length} options.`);
  }

  if (!open) {
    return (
      <div className="variant-editor full">
        <button type="button" className="variant-open" onClick={() => setOpen(true)}>
          <Layers /> Add variant
        </button>
        <small>
          For a product that comes in more than one colour, size or volume. Each option gets
          its own price, barcode and stock.
        </small>
      </div>
    );
  }

  return (
    <div className="variant-editor full is-open">
      <header>
        <span>
          <Layers /> Options
        </span>
        <label>
          Called
          <input
            value={optionName}
            onChange={(event) => setOptionName(event.target.value)}
            placeholder="Colour, Size, Volume…"
            maxLength={40}
          />
        </label>
      </header>
      <div className="variant-table">
        <div className="variant-table-head">
          <span>Option</span>
          <span>Price</span>
          <span>Offer price</span>
          <span>Barcode</span>
          <span>Pack size</span>
          <span>On sale</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div className="variant-table-row" key={row.id ?? `new-${index}`}>
            <input
              value={row.label}
              onChange={(event) => update(index, { label: event.target.value })}
              placeholder={index === 0 ? "Blue" : "Another option"}
              maxLength={80}
              aria-label={`Option ${index + 1} name`}
            />
            <input
              value={row.price}
              onChange={(event) => update(index, { price: event.target.value })}
              inputMode="decimal"
              placeholder="0"
              aria-label={`Option ${index + 1} price`}
            />
            <input
              value={row.discountPrice}
              onChange={(event) => update(index, { discountPrice: event.target.value })}
              inputMode="decimal"
              placeholder="—"
              aria-label={`Option ${index + 1} offer price`}
            />
            <input
              value={row.barcode}
              onChange={(event) => update(index, { barcode: event.target.value })}
              placeholder="—"
              aria-label={`Option ${index + 1} barcode`}
            />
            <input
              value={row.packSize}
              onChange={(event) => update(index, { packSize: event.target.value })}
              placeholder="—"
              aria-label={`Option ${index + 1} pack size`}
            />
            <label className="variant-active">
              <input
                type="checkbox"
                checked={row.isActive}
                onChange={(event) => update(index, { isActive: event.target.checked })}
                aria-label={`Option ${index + 1} on sale`}
              />
            </label>
            <button
              type="button"
              className="variant-remove"
              // The first row is the product itself. Removing it would mean deleting the
              // row that carries the stock and the order history, so it stays.
              disabled={index === 0}
              title={index === 0 ? "This row is the product itself" : "Remove this option"}
              aria-label={`Remove option ${index + 1}`}
              onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <footer>
        <button type="button" className="variant-add" onClick={() => setRows((current) => [...current, blankRow()])}>
          <Plus /> Add another option
        </button>
        <button type="button" className="variant-save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save options"}
        </button>
      </footer>
      {message && <p className="variant-message">{message}</p>}
      <small>
        The first row is this product, and keeps its stock and its past orders. An option you
        remove is taken off sale rather than deleted, because old orders still point at it.
      </small>
    </div>
  );
}
