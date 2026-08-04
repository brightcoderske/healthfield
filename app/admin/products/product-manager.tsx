"use client";

import { ArrowLeft, ImageOff, Package, Plus, Search, Trash2, X } from "lucide-react";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { RichTextEditor } from "./rich-text-editor";

type Product = {
  id: number; categoryId: number; name: string; brand: string | null; packSize: string | null;
  shortDescription: string | null; description: string | null; price: number; discountPrice: number | null; imageUrl: string | null;
  isFeatured: boolean; isActive: boolean; conditionIds: number[];
  prescriptionRequired: boolean;
};
type Option = { id: number; name: string };

export function ProductManager({ initialProducts, categories, conditions }: { initialProducts: Product[]; categories: Option[]; conditions: Option[] }) {
  const [items, setItems] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
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
      isActive: form.get("isActive") === "on", prescriptionRequired: form.get("prescriptionRequired") === "on", conditionIds: form.getAll("conditionIds").map(Number),
    };
    const isNew = editing === "new";
    const targetId = isNew ? "new" : editing.id;
    setSavingId(targetId);
    try {
      if (imageFile) {
        const upload = new FormData();
        upload.set("image", imageFile);
        const uploadResponse = await fetch("/api/products/image", { method: "POST", body: upload });
        const uploadData = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) return setMessage(uploadData.error || "Product image could not be uploaded.");
        payload.imageUrl = uploadData.imageUrl;
      }
      const response = await fetch(isNew ? "/api/products" : `/api/products/${targetId}`, {
        method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error || "Product could not be saved.");
      if (isNew) setItems((current) => [{ ...payload, id: data.id } as Product, ...current]);
      else setItems((current) => current.map((item) => item.id === targetId ? { ...item, ...payload } : item));
      setMessage("");
      setEditing(null);
      setImageFile(null);
      setImagePreview(null);
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
    setRegularPrice(product === "new" ? "" : String(product.price));
    setSellingPrice(product === "new" || product.discountPrice === null ? "" : String(product.discountPrice));
    setImageFile(null);
    setImagePreview(null);
    setMessage("");
  }
  return <main className="compact-admin-page">
    <header><div><a href="/admin"><ArrowLeft/> Dashboard</a><h1>Products</h1><p>Catalogue products and storefront information.</p></div><button onClick={() => openEditor("new")}><Plus/> Add product</button></header>
    <div className="compact-table-tools"><label><Search/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search product or brand"/></label><select value={category} onChange={(event)=>setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{filtered.length} rows</span></div>
    <div className="compact-table"><div className="compact-table-head product-row"><span>Image</span><span>Product</span><span>Category</span><span>Price</span><span>Status</span><span>Action</span></div>
      {filtered.map((product)=>{const saving=product.discountPrice!==null&&product.discountPrice<product.price?Math.round((1-product.discountPrice/product.price)*100):0;return <div className={`compact-table-row product-row ${savingId===product.id?"row-saving":""}`} key={product.id}><span className="table-thumb">{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</span><span><button className="row-link" onClick={()=>openEditor(product)}>{product.name}</button><small>{product.brand || "No brand"}{product.packSize ? ` · ${product.packSize}` : ""}</small></span><span>{categories.find((item)=>item.id===product.categoryId)?.name || "Uncategorised"}</span><strong>KES {(product.discountPrice??product.price).toLocaleString()}{saving>0&&<small>Save {saving}% · was KES {product.price.toLocaleString()}</small>}</strong><span className={product.isActive?"status-active":"status-inactive"}>{savingId===product.id?"Saving…":product.isActive?"Active":"Inactive"}</span><button className="row-delete" disabled={savingId===product.id} onClick={()=>deactivate(product)}><Trash2/></button></div>})}
    </div>
    {editing && <div className="product-modal" onClick={()=>setEditing(null)}><form onSubmit={save} onClick={(event)=>event.stopPropagation()}><header><div><span><h2>{editing==="new"?"Add product":"Edit product"}</h2><p>Changes update only this product row.</p></span></div><button type="button" onClick={()=>setEditing(null)}><X/></button></header>
      <div className="product-form-grid">
        <label>Product name<input name="name" defaultValue={activeEdit?.name||""} required/></label><label>Brand<input name="brand" defaultValue={activeEdit?.brand||""}/></label>
        <label>Category<select name="categoryId" defaultValue={activeEdit?.categoryId||""} required><option value="">Select category</option>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Pack size<input name="packSize" defaultValue={activeEdit?.packSize||""}/></label>
        <label>Regular price (before discount)<input name="price" type="number" min="0" step=".01" value={regularPrice} onChange={event=>setRegularPrice(event.target.value)} required/><small>The normal or previous customer price.</small></label><label>Selling price (customer pays)<input name="discountPrice" type="number" min="0" max={regularPrice||undefined} step=".01" value={sellingPrice} onChange={event=>setSellingPrice(event.target.value)}/><small>{sellingPrice&&regularPrice&&Number(sellingPrice)<Number(regularPrice)?`Discount calculated automatically: Save ${Math.round((1-Number(sellingPrice)/Number(regularPrice))*100)}%`:`Leave blank when the product is not discounted.`}</small></label>
        <label className="full">Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.tif,.tiff" onChange={chooseImage}/><small>JPEG, PNG, WebP, GIF, AVIF, BMP or TIFF. Maximum 2 MB.</small></label>
        {(imagePreview||activeEdit?.imageUrl)&&<div className="edit-image-preview full"><img src={imagePreview||activeEdit?.imageUrl||""} alt={activeEdit?.name||"New product preview"}/>{activeEdit?.imageUrl&&!imagePreview&&<button type="button" onClick={()=>removeImage(activeEdit)}><ImageOff/> Remove image now</button>}</div>}
        <label className="full">Detailed description<RichTextEditor defaultValue={activeEdit?.description||""}/></label>
        <fieldset className="full condition-picker"><legend>Health conditions supported by this product</legend>{conditions.map((item)=><label key={item.id}><input type="checkbox" name="conditionIds" value={item.id} defaultChecked={activeEdit?.conditionIds.includes(item.id)}/><span>{item.name}</span></label>)}</fieldset>
        <label className="check-label"><input type="checkbox" name="prescriptionRequired" defaultChecked={activeEdit?.prescriptionRequired}/> Prescription required</label><label className="check-label"><input type="checkbox" name="isFeatured" defaultChecked={activeEdit?.isFeatured}/> Featured</label><label className="check-label"><input type="checkbox" name="isActive" defaultChecked={activeEdit?.isActive??true}/> Active</label>
      </div>{message&&<div className="auth-error">{message}</div>}<footer><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" disabled={savingId!==null}>{savingId!==null?"Saving product…":"Save product"}</button></footer></form></div>}
  </main>;
}
