"use client";

import { ArrowLeft, ImagePlus, Megaphone, Package, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

export type BannerProduct = { id:number; name:string; imageUrl:string|null; price:string; discountPrice:string|null };
export type PromotionalBanner = { id:number; title:string; imageUrl:string; productId:number; isActive:boolean; displayOrder:number };

const blank: PromotionalBanner = { id:0, title:"", imageUrl:"", productId:0, isActive:true, displayOrder:0 };

export function PromotionalBannerManager({ initial, products }: { initial: PromotionalBanner[]; products: BannerProduct[] }) {
  const [editing, setEditing] = useState<PromotionalBanner | null>(null);
  const [selectedProductId, setSelectedProductId] = useState(0);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
  }, [preview]);

  const selectedProduct = products.find((product) => product.id === selectedProductId) || null;
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return products.filter((product) => product.id !== selectedProductId && product.name.toLowerCase().includes(term)).slice(0, 7);
  }, [products, query, selectedProductId]);

  function open(banner: PromotionalBanner) {
    setEditing(banner);
    setSelectedProductId(banner.productId);
    setImageFile(null);
    setPreview(banner.imageUrl);
    setQuery("");
    setMessage("");
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && file.size > 2 * 1024 * 1024) {
      event.target.value = "";
      setImageFile(null);
      return setMessage("Advert images must be 2 MB or smaller.");
    }
    setMessage("");
    setImageFile(file);
    if (file) setPreview(URL.createObjectURL(file));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!editing || !selectedProductId) return setMessage("Choose the product this advert should open.");
    if (!preview) return setMessage("Upload the advert image customers should see.");
    setSaving(true);
    setMessage("");
    let imageUrl = editing.imageUrl;
    if (imageFile) {
      const upload = new FormData();
      upload.set("image", imageFile);
      const response = await fetch("/api/promotional-banners/image", { method:"POST", body:upload });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaving(false);
        return setMessage(data.error || "The advert image could not be uploaded.");
      }
      imageUrl = data.imageUrl;
    }
    const payload = {
      title:String(form.get("title")), imageUrl, productId:selectedProductId,
      isActive:form.get("isActive") === "on",
      displayOrder:Number(form.get("displayOrder") || 0),
    };
    const response = await fetch(editing.id ? `/api/promotional-banners/${editing.id}` : "/api/promotional-banners", {
      method:editing.id ? "PATCH" : "POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setMessage(data.error || "The promotional banner could not be saved.");
    setMessage(editing.id ? "Promotional banner updated." : "Promotional banner added to the storefront randomizer.");
    window.setTimeout(() => location.reload(), 450);
  }

  async function remove(banner: PromotionalBanner) {
    if (!confirm(`Delete "${banner.title}"?`)) return;
    const response = await fetch(`/api/promotional-banners/${banner.id}`, { method:"DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error || "The promotional banner could not be deleted.");
    location.reload();
  }

  return <main className="promotion-admin">
    <header>
      <div><a href="/admin"><ArrowLeft/> Dashboard</a><span><Megaphone/><div><h1>Promotional banners</h1><p>Upload image adverts and link each one directly to a catalogue product.</p></div></span></div>
      <button type="button" onClick={() => open(blank)}><Plus/> New banner</button>
    </header>

    {message && !editing ? <div className="promotion-admin-message" role="alert">{message}</div> : null}
    <section className="promotion-admin-list">
      {initial.map((banner) => {
        const product = products.find((item) => item.id === banner.productId);
        return <article key={banner.id}>
          <img src={banner.imageUrl} alt={banner.title}/>
          <div><small className={banner.isActive ? "live" : "draft"}>{banner.isActive ? "Live" : "Hidden"}</small><strong>{banner.title}</strong><p>Opens {product?.name || `product #${banner.productId}`}</p></div>
          <div className="promotion-admin-actions"><button type="button" onClick={() => open(banner)}><Pencil/> Edit</button><button type="button" className="danger" onClick={() => remove(banner)} aria-label={`Delete ${banner.title}`}><Trash2/></button></div>
        </article>;
      })}
      {!initial.length ? <div className="promotion-admin-empty"><Megaphone/><strong>No promotional banners yet</strong><span>Upload the first image advert to add it to the storefront randomizer.</span></div> : null}
    </section>

    {editing ? <div className="promotion-modal" onClick={() => !saving && setEditing(null)}>
      <form className="promotion-editor" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header><div><small>{editing.id ? "Edit promotional banner" : "Create promotional banner"}</small><h2>{editing.title || "New image advert"}</h2></div><button type="button" onClick={() => setEditing(null)} aria-label="Close editor"><X/></button></header>
        <div className="promotion-editor-body">
          <section>
            <label>Internal name<input name="title" defaultValue={editing.title} maxLength={180} required placeholder="e.g. August allergy campaign"/><small>Used in the dashboard and as accessible image text; it is not printed over the advert.</small></label>
            <label>Display priority<input name="displayOrder" type="number" min="0" max="10000" defaultValue={editing.displayOrder}/><small>Lower numbers are loaded first before the storefront randomizes the banners.</small></label>
            <label className="promotion-active-toggle"><input name="isActive" type="checkbox" defaultChecked={editing.isActive}/><span><strong>Show on the storefront</strong><small>Hidden banners stay saved but do not join the randomizer.</small></span></label>
          </section>
          <aside>
            <h3>Advert image</h3>
            <div className="promotion-size-guide"><strong>Use a 16:9 landscape image</strong><span>1920 × 1080 pixels is recommended. Other image sizes are accepted and centre-cropped to fill the card, so keep important text and branding away from the edges.</span></div>
            <label className="promotion-image-upload">{preview ? <img src={preview} alt="Advert preview"/> : <span><ImagePlus/><strong>Upload advert artwork</strong><small>JPEG, PNG or WebP · maximum 2 MB</small></span>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage}/></label>
            <small className="promotion-image-note">No text, padding, label, or button is added on the storefront. The whole 16:9 card is clickable.</small>
            <div className="promotion-product-picker">
              <h3>Linked product</h3>
              {selectedProduct ? <article>{selectedProduct.imageUrl ? <img src={selectedProduct.imageUrl} alt=""/> : <span><Package/></span>}<div><strong>{selectedProduct.name}</strong><small>KES {Number(selectedProduct.discountPrice ?? selectedProduct.price).toLocaleString()}</small></div><button type="button" onClick={() => setSelectedProductId(0)} aria-label={`Remove ${selectedProduct.name}`}><X/></button></article> : null}
              <label><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for the product to open"/></label>
              {matches.length ? <div>{matches.map((product) => <button type="button" key={product.id} onClick={() => { setSelectedProductId(product.id); setQuery(""); }}>{product.imageUrl ? <img src={product.imageUrl} alt=""/> : <span><Package/></span>}<span><strong>{product.name}</strong><small>KES {Number(product.discountPrice ?? product.price).toLocaleString()}</small></span></button>)}</div> : null}
              {query.trim() && !matches.length ? <p>No matching products.</p> : null}
            </div>
          </aside>
        </div>
        {message ? <div className="promotion-admin-message" role="alert">{message}</div> : null}
        <footer><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" disabled={saving}><Save/>{saving ? "Saving…" : "Save banner"}</button></footer>
      </form>
    </div> : null}
  </main>;
}
