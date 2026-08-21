"use client";

import { ArrowLeft, Camera, ChevronLeft, ChevronRight, ImageOff, Package, Plus, ScanLine, Search, Table2, Trash2, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MARKUP, marginPercent, sellingPriceFromCost } from "@/lib/profit";
import { BulkEditor } from "./bulk-editor";
import { useEditorDraft } from "../use-editor-draft";
import { useModalViewport } from "../use-modal-viewport";
import { RichTextEditor } from "./rich-text-editor";

type Product = {
  id: number; categoryId: number; name: string; sku: string; barcode: string | null; brand: string | null; packSize: string | null;
  shortDescription: string | null; description: string | null; price: number; discountPrice: number | null; costPrice: string | number | null; costPriceEstimated?: boolean; imageUrl: string | null;
  isFeatured: boolean; isActive: boolean; conditionIds: number[];
  prescriptionRequired: boolean;
};
type Option = { id: number; name: string };
const PAGE_SIZE = 25;

export function ProductManager({ initialProducts, categories, conditions, branches = [], stock = [], canEditCost = false }: { branches?: Array<{id:number;name:string}>; stock?: Array<{branchId:number;productId:number;quantityAvailable:number;reorderLevel:number}>; initialProducts: Product[]; categories: Option[]; conditions: Option[]; canEditCost?: boolean }) {
  const [items, setItems] = useState(initialProducts);
  // Optional: a product saves perfectly well without anyone touching stock here.
  const formRef = useRef<HTMLFormElement>(null);
  // A snapshot of the form, recomputed as it is typed into. Reading the DOM keeps this
  // honest without turning every field into controlled state.
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  // A quantity per shop, keyed by branch id. Empty means "leave this shop alone",
  // which is what keeps stock optional on a form that is mostly about the product.
  const [stockLevels, setStockLevels] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  // Sizes the sheet to what the phone is actually showing, keyboard included, and keeps
  // the focused field above it.
  useModalViewport(editing !== null);
  const [message, setMessage] = useState("");
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [regularPrice, setRegularPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  // Whether the stored buying price was seeded from the shelf price rather than typed
  // by anyone. Shown once, and cleared the moment this form is saved with a figure.
  const [costEstimated, setCostEstimated] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
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
  const [bulk, setBulk] = useState(false);
  // The editor owns the unsaved-work question; the header button just asks it to close.
  const closeBulk = useRef<(() => void) | null>(null);
  const [stockRows, setStockRows] = useState(stock);
  // The formatted description lives inside the editor, not in a plain field, so a
  // recovered draft has to be handed back to it rather than written to the form.
  const restoreDescription = useRef<((html: string) => void) | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      categoryId: Number(form.get("categoryId")), name: String(form.get("name")), brand: String(form.get("brand") || ""),
      barcode: String(form.get("barcode") || "").trim() || null,
      packSize: String(form.get("packSize") || ""), shortDescription: "",
      description: String(form.get("description") || ""),
      price: Number(form.get("price")), discountPrice: form.get("discountPrice") ? Number(form.get("discountPrice")) : null,
      costPrice: form.get("costPrice") ? Number(form.get("costPrice")) : null,
      imageUrl: editing === "new" ? null : editing.imageUrl, isFeatured: form.get("isFeatured") === "on",
      isActive: asDraft ? false : form.get("isActive") === "on", prescriptionRequired: form.get("prescriptionRequired") === "on", conditionIds: form.getAll("conditionIds").map(Number),
      // Only sent when a shop is chosen and a number typed; otherwise stock is left
      // exactly as it was, which is what makes the field genuinely optional.
      // Only shops whose figure was actually typed into. Sending the untouched ones
      // would overwrite another till's count with whatever this form last rendered.
      stock: Object.entries(stockLevels)
        .filter(([, value]) => value !== "" && Number.isFinite(Number(value)))
        .map(([branchId, value]) => ({ branchId: Number(branchId), quantityAvailable: Math.max(0, Math.trunc(Number(value))) })),
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
      if (isNew) setItems((current) => [{ ...payload, id: data.id, sku: data.sku } as Product, ...current]);
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
    barcode: activeEdit?.barcode ?? "",
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
    const next: Record<string, string> = {
      name: String(data.get("name") || ""),
      brand: String(data.get("brand") || ""),
      packSize: String(data.get("packSize") || ""),
      description: String(data.get("description") || ""),
      price: String(data.get("price") || ""),
      discountPrice: String(data.get("discountPrice") || ""),
      categoryId: String(data.get("categoryId") || ""),
    };
    // Every input event in the form reaches here, the formatting ribbon's dropdowns
    // included. Handing back a fresh object each time re-rendered the whole form in the
    // middle of choosing a size — between the dropdown's input and change events — and
    // React put the dropdown back to its label before the choice could be read. Only a
    // real difference is worth a render.
    setSnapshot((current) => (current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next));
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
    setStockLevels(product === "new"
      ? {}
      : Object.fromEntries(branches.map((branch) => {
          const held = stockRows.find((row) => row.branchId === branch.id && row.productId === product.id);
          return [branch.id, held ? String(held.quantityAvailable) : ""];
        })));
    setRegularPrice(product === "new" ? "" : String(product.price));
    setSellingPrice(product === "new" || product.discountPrice === null ? "" : String(product.discountPrice));
    setCostPrice(product === "new" || product.costPrice === null || product.costPrice === undefined ? "" : String(product.costPrice));
    setCostEstimated(product !== "new" && Boolean(product.costPriceEstimated) && product.costPrice !== null);
    setBarcode(product === "new" ? "" : product.barcode || "");
    setImageFile(null);
    setImagePreview(null);
    setMessage("");
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") openEditor("new");
  }, []);
  return <main className="compact-admin-page">
    <header><div><a href="/admin"><ArrowLeft/> Dashboard</a><h1>Products</h1></div><div className="product-header-actions">{canEditCost ? <button type="button" className="bulk-open" onClick={() => (bulk ? closeBulk.current?.() : setBulk(true))}><Table2/> {bulk ? "Close bulk edit" : "Bulk edit"}</button> : null}<button onClick={() => openEditor("new")}><Plus/> Add product</button></div></header>
    {bulk && canEditCost ? <BulkEditor
      products={items}
      categories={categories}
      branches={branches}
      stock={stockRows}
      registerClose={(close) => { closeBulk.current = close; }}
      onClose={() => setBulk(false)}
      onSaved={(rows) => {
        // The save was one transaction, so every row here is already stored; adopting
        // them beats a reload that would lose the page and filters someone is working.
        setItems((current) => current.map((item) => {
          const saved = rows.find((row) => row.id === item.id);
          return saved ? { ...item, name: saved.name, price: saved.price, discountPrice: saved.discountPrice, costPrice: saved.costPrice, costPriceEstimated: saved.costPrice === null } : item;
        }));
        setStockRows((current) => {
          const next = [...current];
          for (const row of rows) for (const entry of row.stock) {
            const index = next.findIndex((item) => item.productId === row.id && item.branchId === entry.branchId);
            if (index >= 0) next[index] = { ...next[index], quantityAvailable: entry.quantityAvailable };
            else next.push({ productId: row.id, branchId: entry.branchId, quantityAvailable: entry.quantityAvailable, reorderLevel: 5 });
          }
          return next;
        });
      }}
    /> : null}
    <div className="compact-table-tools"><label><Search/><input value={query} onChange={(event)=>{setQuery(event.target.value);setPage(1)}} placeholder="Search all products by name or brand"/></label><select value={category} onChange={(event)=>{setCategory(event.target.value);setPage(1)}}><option value="all">All categories</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{filtered.length} products</span></div>
    <div className="compact-table"><div className="compact-table-head product-row"><span>Image</span><span>Product</span><span>Category</span><span>Price</span><span>Status</span><span>Action</span></div>
      {visibleProducts.map((product)=>{const saving=product.discountPrice!==null&&product.discountPrice<product.price?Math.round((1-product.discountPrice/product.price)*100):0;return <div className={`compact-table-row product-row ${savingId===product.id?"row-saving":""}`} key={product.id}><span className="table-thumb">{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</span><span><button className="row-link" title={product.name} onClick={()=>openEditor(product)}>{product.name}</button><small>{product.brand || "No brand"}{product.packSize ? ` · ${product.packSize}` : ""}</small></span><span title={categories.find((item)=>item.id===product.categoryId)?.name || "Uncategorised"}>{categories.find((item)=>item.id===product.categoryId)?.name || "Uncategorised"}</span><strong>KES {(product.discountPrice??product.price).toLocaleString()}{saving>0&&<small>Save {saving}% · was KES {product.price.toLocaleString()}</small>}</strong><span className={product.isActive?"status-active":"status-inactive"}>{savingId===product.id?"Saving…":product.isActive?"Active":"Inactive"}</span><button className="row-delete" aria-label={`Delete ${product.name}`} disabled={savingId===product.id} onClick={()=>deactivate(product)}><Trash2/></button></div>})}
      {!visibleProducts.length&&<div className="compact-table-empty"><Package/><strong>No matching products</strong><span>Try another search or category.</span></div>}
    </div>
    <nav className="compact-pagination" aria-label="Product table pages"><button type="button" onClick={()=>setPage((value)=>Math.max(1,value-1))} disabled={currentPage===1}><ChevronLeft/> Previous</button><span>Page <strong>{currentPage}</strong> of {pageCount} · showing {visibleProducts.length} of {filtered.length}</span><button type="button" onClick={()=>setPage((value)=>Math.min(pageCount,value+1))} disabled={currentPage===pageCount}>Next <ChevronRight/></button></nav>
    {editing && <div className="product-modal" onClick={()=>setEditing(null)}><form ref={formRef} onInput={captureForm} onSubmit={save} onInvalidCapture={(event)=>{
      // A required field the browser refuses to submit is often off screen on a phone,
      // so the press on Save looked like it did nothing at all.
      const field = event.target as HTMLElement;
      field.scrollIntoView?.({ block: "center", behavior: "smooth" });
      setMessage("Fill in the highlighted field, then press save again.");
    }} onClick={(event)=>event.stopPropagation()}><header><div><span><h2>{editing==="new"?"Add product":"Edit product"}</h2><p>Changes update only this product row.</p></span></div><button type="button" onClick={()=>setEditing(null)}><X/></button></header>
      {draft.recovered ? (
        <div className="editor-draft-notice" role="status">
          <strong>Unsaved work from {draft.recovered.age}</strong>
          <span>found on this device.</span>
          <button type="button" onClick={() => {
            const values = draft.recovered!.values as Record<string, string>;
            const form = formRef.current;
            if (form) {
              for (const [field, value] of Object.entries(values)) {
                if (field === "description") continue;
                const input = form.elements.namedItem(field) as HTMLInputElement | null;
                if (input && "value" in input) input.value = value;
              }
              restoreDescription.current?.(values.description ?? "");
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
        <label className="full product-code-field">Barcode or QR code<span><input name="barcode" value={barcode} onChange={(event)=>setBarcode(event.target.value)} inputMode="numeric" placeholder="Scan with USB scanner or type the code"/><button type="button" onClick={()=>setScannerOpen(true)}><Camera/> Scan with camera</button></span><small>The POS recognises this code immediately. A connected USB scanner can type directly into this field.</small></label>
        {canEditCost ? <label>Buying price (what you paid)<input name="costPrice" type="number" min="0" step=".01" value={costPrice} onChange={event=>{
          const value = event.target.value;
          setCostPrice(value);
          setCostEstimated(false);
          // Typing a buying price prices the product: selling price at 133%, and the
          // regular price follows it up when it would otherwise sit below — a selling
          // price above the regular price is not a discount, it is a rejected save.
          const selling = sellingPriceFromCost(value);
          if (selling === null) return;
          setSellingPrice(selling.toFixed(2));
          if (!regularPrice || Number(regularPrice) < selling) setRegularPrice(selling.toFixed(2));
        }}/><small>{costEstimated ? "Estimated from the shelf price when buying prices were introduced — confirm it and profit stops being a guess." : costPrice && Number(costPrice) > 0 ? `Sells at ${DEFAULT_MARKUP * 100}% of this: KES ${(sellingPriceFromCost(costPrice) ?? 0).toLocaleString()}${marginPercent(costPrice, sellingPrice || regularPrice) !== null ? ` · ${marginPercent(costPrice, sellingPrice || regularPrice)}% margin` : ""}` : "Used for profit reporting only. Customers never see it."}</small></label> : null}
        <label>Regular price (before discount)<input name="price" type="number" min="0" step=".01" value={regularPrice} onChange={event=>setRegularPrice(event.target.value)} required/><small>The normal or previous customer price.</small></label><label>Selling price (customer pays)<input name="discountPrice" type="number" min="0" max={regularPrice||undefined} step=".01" value={sellingPrice} onChange={event=>setSellingPrice(event.target.value)}/><small>{sellingPrice&&regularPrice&&Number(sellingPrice)<Number(regularPrice)?`Discount calculated automatically: Save ${Math.round((1-Number(sellingPrice)/Number(regularPrice))*100)}%`:`Leave blank when the product is not discounted.`}</small></label>
        <label className="full">Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tif,.tiff" onChange={chooseImage}/><small>JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF. Maximum 2 MB.</small></label>
        {(imagePreview||activeEdit?.imageUrl)&&<div className="edit-image-preview full"><img src={imagePreview||activeEdit?.imageUrl||""} alt={activeEdit?.name||"New product preview"}/>{activeEdit?.imageUrl&&!imagePreview&&<button type="button" onClick={()=>removeImage(activeEdit)}><ImageOff/> Remove image now</button>}</div>}
        <div className="full rich-text-field"><span>Detailed description</span><RichTextEditor restoreRef={restoreDescription} defaultValue={activeEdit?.description||""} rows={10} maxLength={10000} helper="Formatting counts toward the limit, so a richly styled description uses more than its visible text"/></div>
        <fieldset className="full condition-picker"><legend>Health conditions supported by this product</legend>{conditions.map((item)=><label key={item.id}><input type="checkbox" name="conditionIds" value={item.id} defaultChecked={activeEdit?.conditionIds.includes(item.id)}/><span>{item.name}</span></label>)}</fieldset>
        {branches.length ? (
          // Collapsed by default: stock is the exception when editing a product, so it
          // should not push the buttons people came for further down the form.
          <details className="full product-stock-block">
            <summary>Stock <span>optional</span></summary>
            <p>Leave this closed to save the product without changing any stock. Every shop is listed; type into the ones whose count has changed.</p>
            <div className="product-stock-grid">
              {branches.map((branch) => {
                const held = activeEdit ? stockRows.find((row) => row.branchId === branch.id && row.productId === activeEdit.id) : undefined;
                return <label key={branch.id}>
                  <span>{branch.name}</span>
                  <input type="number" min="0" step="1" inputMode="numeric"
                    value={stockLevels[branch.id] ?? ""}
                    onChange={(event) => setStockLevels((current) => ({ ...current, [branch.id]: event.target.value }))}
                    placeholder={held ? String(held.quantityAvailable) : "No change"} />
                  <small>{held ? `Currently ${held.quantityAvailable} in stock${held.reorderLevel ? ` · reorder at ${held.reorderLevel}` : ""}` : "No stock record yet"}</small>
                </label>;
              })}
            </div>
          </details>
        ) : null}
        <div className="product-flags full"><label className="check-label"><input type="checkbox" name="prescriptionRequired" defaultChecked={activeEdit?.prescriptionRequired}/> Prescription required</label><label className="check-label"><input type="checkbox" name="isActive" defaultChecked={activeEdit?.isActive??true}/> Active</label><label className="check-label"><input type="checkbox" name="isFeatured" defaultChecked={activeEdit?.isFeatured}/> Featured product</label></div>
      </div>{message&&<div className="auth-error">{message}</div>}<footer>{draft.savedAt?<span className="editor-draft-status">Kept on this device</span>:null}<button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="draft-button" disabled={savingId!==null} onClick={()=>setAsDraft(true)}>Save as draft</button><button type="submit" disabled={savingId!==null} onClick={()=>setAsDraft(false)}>{savingId!==null?"Saving product…":"Save product"}</button></footer></form>{scannerOpen?<ProductCodeScanner onClose={()=>setScannerOpen(false)} onCode={(code)=>{setBarcode(code);setScannerOpen(false)}}/>:null}</div>}
  </main>;
}

function ProductCodeScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting camera…");
  useEffect(() => {
    let stopped = false; let stream: MediaStream | null = null; let frame = 0;
    async function start() {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        if (!Detector) throw new Error("Camera code scanning is not supported in this browser. Use the USB scanner or type the code.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!video.current || stopped) return; video.current.srcObject = stream; await video.current.play();
        const detector = new Detector({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] });
        setMessage("Point the camera at the barcode or QR code.");
        const detect = async () => { if (stopped || !video.current) return; try { const found = await detector.detect(video.current); if (found[0]?.rawValue) return onCode(found[0].rawValue); } catch { /* keep scanning */ } frame = requestAnimationFrame(detect); };
        frame = requestAnimationFrame(detect);
      } catch (error) { setMessage(error instanceof Error ? error.message : "The camera could not be opened."); }
    }
    void start();
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); };
  }, [onCode]);
  return <section className="product-code-scanner" role="dialog" aria-modal="true" aria-label="Scan product code" onClick={(event)=>event.stopPropagation()}><div><header><span><ScanLine/><b>Scan product code</b></span><button type="button" onClick={onClose}><X/></button></header><video ref={video} playsInline muted/><i/><p>{message}</p></div></section>;
}
