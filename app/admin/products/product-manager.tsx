"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, ImageOff, Package, Plus, Search, Trash2, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useEditorDraft } from "../use-editor-draft";
import { RichTextEditor } from "./rich-text-editor";

type Product = {
  id: number; categoryId: number; name: string; brand: string | null; packSize: string | null;
  shortDescription: string | null; description: string | null; price: number; discountPrice: number | null; imageUrl: string | null;
  isFeatured: boolean; isActive: boolean; conditionIds: number[];
  prescriptionRequired: boolean;
};
type Option = { id: number; name: string };
const PAGE_SIZE = 25;

export function ProductManager({ initialProducts, categories, conditions, branches = [], stock = [] }: { branches?: Array<{id:number;name:string}>; stock?: Array<{branchId:number;productId:number;quantityAvailable:number;reorderLevel:number}>; initialProducts: Product[]; categories: Option[]; conditions: Option[] }) {
  const [items, setItems] = useState(initialProducts);
  // Optional: a product saves perfectly well without anyone touching stock here.
  const formRef = useRef<HTMLFormElement>(null);
  // A snapshot of the form, recomputed as it is typed into. Reading the DOM keeps this
  // honest without turning every field into controlled state.
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [stockBranch, setStockBranch] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [regularPrice, setRegularPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const filtered = useMemo(() => items.filter((item) =>
    `${item.name} ${item.brand || ""}`.toLowerCase().includes(query.toLowerCase()) &&
    (category === "all" || item.categoryId === Number(category)),
  ), [items, query, category]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleProducts = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Saving as a draft stores the product with the storefront listing switched off, so
  // half-finished work can be kept without ever being shown to a customer.
  const [asDraft, setAsDraft] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      categoryId: Number(form.get("categoryId")), name: String(form.get("name")), brand: String(form.get("brand") || ""),
      packSize: String(form.get("packSize") || ""), shortDescription: "",
      description: String(form.get("description") || ""),
      price: Number(form.get("price")), discountPrice: form.get("discountPrice") ? Number(form.get("discountPrice")) : null,
      imageUrl: editing === "new" ? null : editing.imageUrl, isFeatured: form.get("isFeatured") === "on",
      isActive: asDraft ? false : form.get("isActive") === "on", prescriptionRequired: form.get("prescriptionRequired") === "on", conditionIds: form.getAll("conditionIds").map(Number),
      // Only sent when a shop is chosen and a number typed; otherwise stock is left
      // exactly as it was, which is what makes the field genuinely optional.
      stock: stockBranch && stockQuantity !== ""
        ? { branchId: Number(stockBranch), quantityAvailable: Math.max(0, Number(stockQuantity) || 0) }
        : null,
    };
    const isNew = editing === "new";
    const targetId = isNew ? "new" : editing.id;
    setSavingId(targetId);
    try {
      if (imageFile) {
        const upload = new FormData();
        upload.set("image", imageFile);
        const uploadResponse = await fetch("/api/products/image", { method: "POST", body: upload, signal: AbortSignal.timeout(60_000) });
        const uploadData = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) return setMessage(uploadData.error || "Product image could not be uploaded.");
        payload.imageUrl = uploadData.imageUrl;
      }
      const response = await fetch(isNew ? "/api/products" : `/api/products/${targetId}`, {
        signal: AbortSignal.timeout(30_000),
        method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error || "Product could not be saved.");
      // Saved for real, so the on-device copy has done its job.
      draft.discard();
      if (isNew) setItems((current) => [{ ...payload, id: data.id } as Product, ...current]);
      else setItems((current) => current.map((item) => item.id === targetId ? { ...item, ...payload } : item));
      setMessage("");
      setEditing(null);
      setImageFile(null);
      setImagePreview(null);
    } catch (error) {
      // The draft is still in local storage, so the work is not lost — say so, because
      // the reflex after a failed save on a phone is to close the modal.
      setMessage(
        error instanceof Error && error.name === "TimeoutError"
          ? "Saving timed out. Your work is kept on this device — check your connection and press save again."
          : "Could not reach the server. Your work is kept on this device; try saving again.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function removeImage(product: Product) {
    setSavingId(product.id);
    const response = await fetch(`/api/products/${product.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageUrl: null }) });
    if (response.ok) {
      setItems((current) => current.map((item) => item.id === product.id ? { ...item, imageUrl: null } : item));
      setEditing({ ...product, imageUrl: null });
    }
    setSavingId(null);
  }

  async function deactivate(product: Product) {
    if (!window.confirm(`Permanently delete ${product.name}? Historical order text will be preserved.`)) return;
    setSavingId(product.id);
    const response = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setItems((current) => current.filter((item) => item.id !== product.id)); else setMessage(data.error || "Product could not be deleted.");
    setSavingId(null);
  }
  const activeEdit = editing === "new" ? null : editing;

  // What the record looked like when opened. A draft is only offered when it genuinely
  // differs from this, so merely opening a product never raises a prompt.
  const baseline = useMemo(() => (editing ? {
    name: activeEdit?.name ?? "",
    brand: activeEdit?.brand ?? "",
    packSize: activeEdit?.packSize ?? "",
    description: activeEdit?.description ?? "",
    price: activeEdit ? String(activeEdit.price) : "",
    discountPrice: activeEdit?.discountPrice != null ? String(activeEdit.discountPrice) : "",
    categoryId: activeEdit ? String(activeEdit.categoryId) : "",
  } : null), [editing, activeEdit]);

  const draft = useEditorDraft({
    kind: "product",
    id: editing === "new" ? "new" : activeEdit?.id ?? null,
    values: snapshot as Record<string, unknown> | null,
    baseline,
  });

  /** Reads the form as it stands, so the draft keeps up without controlling every field. */
  function captureForm() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setSnapshot({
      name: String(data.get("name") || ""),
      brand: String(data.get("brand") || ""),
      packSize: String(data.get("packSize") || ""),
      description: String(data.get("description") || ""),
      price: String(data.get("price") || ""),
      discountPrice: String(data.get("discountPrice") || ""),
      categoryId: String(data.get("categoryId") || ""),
    });
  }
  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setMessage("");
    if (file && file.size > 2 * 1024 * 1024) {
      event.target.value = "";
      setImageFile(null);
      setImagePreview(null);
      return setMessage("Product images must be 2 MB or smaller.");
    }
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }
  function openEditor(product: Product | "new") {
    setEditing(product);
    // A stock figure typed for one product must not follow you into the next.
    setStockBranch("");
    setStockQuantity("");
    setRegularPrice(product === "new" ? "" : String(product.price));
    setSellingPrice(product === "new" || product.discountPrice === null ? "" : String(product.discountPrice));
    setImageFile(null);
    setImagePreview(null);
    setMessage("");
  }
  return <main className="compact-admin-page">
    <header><div><a href="/admin"><ArrowLeft/> Dashboard</a><h1>Products</h1></div><button onClick={() => openEditor("new")}><Plus/> Add product</button></header>
    <div className="compact-table-tools"><label><Search/><input value={query} onChange={(event)=>{setQuery(event.target.value);setPage(1)}} placeholder="Search all products by name or brand"/></label><select value={category} onChange={(event)=>{setCategory(event.target.value);setPage(1)}}><option value="all">All categories</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{filtered.length} products</span></div>
    <div className="compact-table"><div className="compact-table-head product-row"><span>Image</span><span>Product</span><span>Category</span><span>Price</span><span>Status</span><span>Action</span></div>
      {visibleProducts.map((product)=>{const saving=product.discountPrice!==null&&product.discountPrice<product.price?Math.round((1-product.discountPrice/product.price)*100):0;return <div className={`compact-table-row product-row ${savingId===product.id?"row-saving":""}`} key={product.id}><span className="table-thumb">{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</span><span><button className="row-link" title={product.name} onClick={()=>openEditor(product)}>{product.name}</button><small>{product.brand || "No brand"}{product.packSize ? ` · ${product.packSize}` : ""}</small></span><span title={categories.find((item)=>item.id===product.categoryId)?.name || "Uncategorised"}>{categories.find((item)=>item.id===product.categoryId)?.name || "Uncategorised"}</span><strong>KES {(product.discountPrice??product.price).toLocaleString()}{saving>0&&<small>Save {saving}% · was KES {product.price.toLocaleString()}</small>}</strong><span className={product.isActive?"status-active":"status-inactive"}>{savingId===product.id?"Saving…":product.isActive?"Active":"Inactive"}</span><button className="row-delete" aria-label={`Delete ${product.name}`} disabled={savingId===product.id} onClick={()=>deactivate(product)}><Trash2/></button></div>})}
      {!visibleProducts.length&&<div className="compact-table-empty"><Package/><strong>No matching products</strong><span>Try another search or category.</span></div>}
    </div>
    <nav className="compact-pagination" aria-label="Product table pages"><button type="button" onClick={()=>setPage((value)=>Math.max(1,value-1))} disabled={currentPage===1}><ChevronLeft/> Previous</button><span>Page <strong>{currentPage}</strong> of {pageCount} · showing {visibleProducts.length} of {filtered.length}</span><button type="button" onClick={()=>setPage((value)=>Math.min(pageCount,value+1))} disabled={currentPage===pageCount}>Next <ChevronRight/></button></nav>
    {editing && <div className="product-modal" onClick={()=>setEditing(null)}><form ref={formRef} onInput={captureForm} onSubmit={save} onClick={(event)=>event.stopPropagation()}><header><div><span><h2>{editing==="new"?"Add product":"Edit product"}</h2><p>Changes update only this product row.</p></span></div><button type="button" onClick={()=>setEditing(null)}><X/></button></header>
      {draft.recovered ? (
        <div className="editor-draft-notice" role="status">
          <strong>Unsaved work from {draft.recovered.age}</strong>
          <span>found on this device.</span>
          <button type="button" onClick={() => {
            const values = draft.recovered!.values as Record<string, string>;
            const form = formRef.current;
            if (form) {
              for (const [field, value] of Object.entries(values)) {
                const input = form.elements.namedItem(field) as HTMLInputElement | null;
                if (input && "value" in input) input.value = value;
              }
              captureForm();
            }
            draft.dismiss();
          }}>Restore it</button>
          <button type="button" onClick={draft.discard}>Discard</button>
        </div>
      ) : null}
      <div className="product-form-grid">
        <label>Product name<input name="name" defaultValue={activeEdit?.name||""} required/></label><label>Brand<input name="brand" defaultValue={activeEdit?.brand||""}/></label>
        <label>Category<select name="categoryId" defaultValue={activeEdit?.categoryId||""} required><option value="">Select category</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Pack size<input name="packSize" defaultValue={activeEdit?.packSize||""}/></label>
        <label>Regular price (before discount)<input name="price" type="number" min="0" step=".01" value={regularPrice} onChange={event=>setRegularPrice(event.target.value)} required/><small>The normal or previous customer price.</small></label><label>Selling price (customer pays)<input name="discountPrice" type="number" min="0" max={regularPrice||undefined} step=".01" value={sellingPrice} onChange={event=>setSellingPrice(event.target.value)}/><small>{sellingPrice&&regularPrice&&Number(sellingPrice)<Number(regularPrice)?`Discount calculated automatically: Save ${Math.round((1-Number(sellingPrice)/Number(regularPrice))*100)}%`:`Leave blank when the product is not discounted.`}</small></label>
        <label className="full">Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tif,.tiff" onChange={chooseImage}/><small>JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF. Maximum 2 MB.</small></label>
        {(imagePreview||activeEdit?.imageUrl)&&<div className="edit-image-preview full"><img src={imagePreview||activeEdit?.imageUrl||""} alt={activeEdit?.name||"New product preview"}/>{activeEdit?.imageUrl&&!imagePreview&&<button type="button" onClick={()=>removeImage(activeEdit)}><ImageOff/> Remove image now</button>}</div>}
        <div className="full rich-text-field"><span>Detailed description</span><RichTextEditor defaultValue={activeEdit?.description||""} rows={10} maxLength={10000} helper="Formatting counts toward the limit, so a richly styled description uses more than its visible text"/></div>
        <fieldset className="full condition-picker"><legend>Health conditions supported by this product</legend>{conditions.map((item)=><label key={item.id}><input type="checkbox" name="conditionIds" value={item.id} defaultChecked={activeEdit?.conditionIds.includes(item.id)}/><span>{item.name}</span></label>)}</fieldset>
        {branches.length ? (
          // Collapsed by default: stock is the exception when editing a product, so it
          // should not push the buttons people came for further down the form.
          <details className="full product-stock-block">
            <summary>Stock <span>optional</span></summary>
            <p>Leave this closed to save the product without changing any stock. Pick a shop to set what it currently holds.</p>
            <div className="product-stock-row">
              <label>
                Shop
                <select value={stockBranch} onChange={(event) => {
                  const value = event.target.value;
                  setStockBranch(value);
                  // Show what that shop already holds, so the number is edited rather
                  // than guessed and accidentally overwritten with a lower figure.
                  const current = value && activeEdit
                    ? stock.find((row) => row.branchId === Number(value) && row.productId === activeEdit.id)
                    : undefined;
                  setStockQuantity(current ? String(current.quantityAvailable) : "");
                }}>
                  <option value="">No change</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <label>
                Units available
                <input type="number" min="0" step="1" value={stockQuantity} disabled={!stockBranch}
                  onChange={(event) => setStockQuantity(event.target.value)} placeholder={stockBranch ? "0" : "Pick a shop first"} />
              </label>
            </div>
          </details>
        ) : null}
        <div className="product-flags full"><label className="check-label"><input type="checkbox" name="prescriptionRequired" defaultChecked={activeEdit?.prescriptionRequired}/> Prescription required</label><label className="check-label"><input type="checkbox" name="isActive" defaultChecked={activeEdit?.isActive??true}/> Active</label><label className="check-label"><input type="checkbox" name="isFeatured" defaultChecked={activeEdit?.isFeatured}/> Featured product</label></div>
      </div>{message&&<div className="auth-error">{message}</div>}<footer>{draft.savedAt?<span className="editor-draft-status">Kept on this device</span>:null}<button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="draft-button" disabled={savingId!==null} onClick={()=>setAsDraft(true)}>Save as draft</button><button type="submit" disabled={savingId!==null} onClick={()=>setAsDraft(false)}>{savingId!==null?"Saving product…":"Save product"}</button></footer></form></div>}
  </main>;
}
