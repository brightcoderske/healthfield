"use client";
import { Package, Percent, Plus, Save, Search, Tag, Trash2, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

export type OfferProduct = { id:number; name:string; imageUrl:string|null; price:string; discountPrice:string|null };
export type OfferItem = { productId:number; offerPrice:string|null; quantity:number };
export type Offer = { id:number; title:string; description:string|null; bundlePrice:string|null; endsAt:string|null; isActive:boolean; items:OfferItem[] };

const blank: Offer = { id: 0, title: "", description: "", bundlePrice: null, endsAt: null, isActive: true, items: [] };
const money = (value: string | number | null) => value === null || value === "" ? "" : Number(value).toString();
const localDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";

export function OfferManager({ initial, products }: { initial: Offer[]; products: OfferProduct[] }) {
  const [editing, setEditing] = useState<Offer | null>(null);
  const [items, setItems] = useState<OfferItem[]>([]);
  const [bundlePrice, setBundlePrice] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const isGroup = items.length > 1;
  const normalTotal = items.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return sum + (product ? Number(product.discountPrice ?? product.price) * item.quantity : 0);
  }, 0);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return products.filter((product) => !items.some((item) => item.productId === product.id) && product.name.toLowerCase().includes(term)).slice(0, 6);
  }, [products, query, items]);

  function open(offer: Offer) {
    setEditing(offer);
    setItems(offer.items.map((item) => ({ ...item, offerPrice: money(item.offerPrice) })));
    setBundlePrice(money(offer.bundlePrice));
    setQuery(""); setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (!items.length) return setMessage("Add at least one product to the offer.");
    if (isGroup && !Number(bundlePrice)) return setMessage("Set the total price customers pay for this collection.");
    if (!isGroup && !Number(items[0]?.offerPrice)) return setMessage("Set the offer price for the product.");
    setSaving(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title")),
      description: String(form.get("description") || ""),
      endsAt: String(form.get("endsAt") || ""),
      isActive: form.get("isActive") === "on",
      bundlePrice: isGroup ? Number(bundlePrice) : null,
      items: items.map((item) => ({ productId: item.productId, quantity: item.quantity, offerPrice: isGroup ? null : Number(item.offerPrice) })),
    };
    const response = await fetch(editing.id ? `/api/offers/${editing.id}` : "/api/offers", { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setMessage(data.error || "The offer could not be saved.");
    location.reload();
  }

  async function remove(offer: Offer) {
    if (!confirm(`Delete "${offer.title}"? Products keep their normal prices.`)) return;
    const response = await fetch(`/api/offers/${offer.id}`, { method: "DELETE" });
    if (response.ok) location.reload();
  }

  return <main className="data-page offers-admin">
    <header><a href="/admin">← Dashboard</a><h1>Offers</h1><button type="button" onClick={() => open(blank)}><Plus/> New offer</button></header>

    {initial.length ? <div className="offers-table-scroller">
      <table className="offers-table">
        <thead>
          <tr>
            <th>Offer</th><th>Type</th><th>Products</th><th>Normal</th><th>Offer price</th><th>Saving</th><th>Ends</th><th>Status</th><th aria-label="Actions"/>
          </tr>
        </thead>
        <tbody>
          {initial.map((offer) => {
            const expired = offer.endsAt ? new Date(offer.endsAt).getTime() <= Date.now() : false;
            const live = offer.isActive && !expired;
            const group = offer.items.length > 1;
            const normal = offer.items.reduce((sum, item) => {
              const product = products.find((entry) => entry.id === item.productId);
              return sum + (product ? Number(product.discountPrice ?? product.price) * item.quantity : 0);
            }, 0);
            const price = group ? Number(offer.bundlePrice ?? 0) : Number(offer.items[0]?.offerPrice ?? 0);
            const saving = normal > price ? normal - price : 0;
            const names = offer.items.map((item) => products.find((entry) => entry.id === item.productId)?.name || `#${item.productId}`);
            return <tr key={offer.id}>
              <td>
                <button type="button" className="offers-table-name" onClick={() => open(offer)}>{offer.title}</button>
                {offer.description && <small>{offer.description}</small>}
              </td>
              <td><span className={`offer-kind ${group ? "group" : "single"}`}>{group ? "Collection" : "Single"}</span></td>
              <td className="offers-table-products"><span title={names.join(", ")}>{names.join(", ")}</span><small>{offer.items.length} item{offer.items.length === 1 ? "" : "s"}</small></td>
              <td>{normal ? `KES ${normal.toLocaleString()}` : "—"}</td>
              <td><b>KES {price.toLocaleString()}</b></td>
              <td>{saving ? <em className="offers-table-saving">KES {saving.toLocaleString()}</em> : "—"}</td>
              <td>{offer.endsAt ? new Date(offer.endsAt).toLocaleDateString("en-KE") : <span className="offers-table-muted">No end date</span>}</td>
              <td><span className={`offer-state ${live ? "live" : "off"}`}>{live ? "Live" : expired ? "Ended" : "Inactive"}</span></td>
              <td>
                <div className="offers-admin-actions">
                  <button type="button" onClick={() => open(offer)}>Edit</button>
                  <button type="button" className="danger" onClick={() => remove(offer)} aria-label={`Delete ${offer.title}`}><Trash2/></button>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <p className="offers-admin-empty"><Percent/> No offers yet. Create one to promote a product or a collection.</p>}

    {editing && <div className="offer-modal" onClick={() => !saving && setEditing(null)}>
      <form className="offer-editor" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header>
          <div><small>{editing.id ? "Edit offer" : "Create offer"}</small><h2>{editing.title || "New offer"}</h2></div>
          <button type="button" onClick={() => setEditing(null)} aria-label="Close"><X/></button>
        </header>

        <div className="offer-editor-body">
          <section>
            <label>Offer title<input name="title" defaultValue={editing.title} maxLength={180} required placeholder="e.g. Cold &amp; Flu bundle"/></label>
            <label>Short description<textarea name="description" rows={2} maxLength={500} defaultValue={editing.description || ""} placeholder="Shown on the offer card"/></label>
            <label>Offer ends<input type="date" name="endsAt" defaultValue={localDate(editing.endsAt)}/><small>Leave empty to run until switched off. Prices revert automatically after this date.</small></label>
            <label className="offer-active-toggle"><input type="checkbox" name="isActive" defaultChecked={editing.isActive}/><span><strong>Offer is active</strong><small>Uncheck to hide it from customers immediately</small></span></label>
          </section>

          <aside>
            <h3><Tag/> Products in this offer</h3>
            <div className="offer-item-list">
              {items.length ? items.map((item) => {
                const product = products.find((entry) => entry.id === item.productId);
                return <article key={item.productId}>
                  {product?.imageUrl ? <img src={product.imageUrl} alt=""/> : <span><Package/></span>}
                  <div>
                    <strong>{product?.name || `Product #${item.productId}`}</strong>
                    <small>Normally KES {Number(product?.discountPrice ?? product?.price ?? 0).toLocaleString()}</small>
                  </div>
                  {!isGroup && <label className="offer-price-field">KES<input type="number" min="0" step="1" value={item.offerPrice ?? ""} onChange={(event) => setItems((current) => current.map((row) => row.productId === item.productId ? { ...row, offerPrice: event.target.value } : row))} placeholder="Offer price"/></label>}
                  {isGroup && <label className="offer-qty-field">Qty<input type="number" min="1" max="99" value={item.quantity} onChange={(event) => setItems((current) => current.map((row) => row.productId === item.productId ? { ...row, quantity: Math.max(1, Number(event.target.value) || 1) } : row))}/></label>}
                  <button type="button" aria-label="Remove" onClick={() => setItems((current) => current.filter((row) => row.productId !== item.productId))}><X/></button>
                </article>;
              }) : <p className="offer-empty">No products added yet.</p>}
            </div>

            <label className="offer-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products to add"/></label>
            {matches.length > 0 && <div className="offer-results">
              {matches.map((product) => <button type="button" key={product.id} onClick={() => { setItems((current) => [...current, { productId: product.id, offerPrice: "", quantity: 1 }]); setQuery(""); }}>
                {product.imageUrl ? <img src={product.imageUrl} alt=""/> : <span><Package/></span>}
                <span><strong>{product.name}</strong><small>KES {Number(product.discountPrice ?? product.price).toLocaleString()}</small></span>
              </button>)}
            </div>}

            {isGroup && <div className="offer-bundle-price">
              <label>Total price for the collection<span>KES<input type="number" min="0" step="1" value={bundlePrice} onChange={(event) => setBundlePrice(event.target.value)} placeholder="e.g. 1200"/></span></label>
              <small>Bought together as one item. Individual product prices are unchanged. Normally KES {normalTotal.toLocaleString()}{Number(bundlePrice) > 0 && Number(bundlePrice) < normalTotal ? ` · saves KES ${(normalTotal - Number(bundlePrice)).toLocaleString()}` : ""}.</small>
            </div>}
            {!isGroup && items.length === 1 && <small className="offer-hint">While this offer runs, the product sells at the offer price everywhere on the site.</small>}
          </aside>
        </div>

        {message && <div className="offer-message" role="alert">{message}</div>}
        <footer>
          <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" disabled={saving}><Save/>{saving ? "Saving…" : "Save offer"}</button>
        </footer>
      </form>
    </div>}
  </main>;
}
