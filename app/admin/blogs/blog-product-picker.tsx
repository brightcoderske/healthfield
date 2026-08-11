"use client";
import { Package, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export type PickerProduct = { id:number; name:string; imageUrl:string|null; price:string; discountPrice:string|null };

export const blogProductLimit = 3;

export function BlogProductPicker({ catalogue, selected, onChange }: { catalogue: PickerProduct[]; selected: number[]; onChange:(next:number[])=>void }) {
  const [query, setQuery] = useState("");
  const chosen = selected.map((id) => catalogue.find((item) => item.id === id)).filter(Boolean) as PickerProduct[];
  const full = selected.length >= blogProductLimit;
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return catalogue.filter((item) => !selected.includes(item.id) && item.name.toLowerCase().includes(term)).slice(0, 6);
  }, [catalogue, query, selected]);

  return <div className="blog-product-picker">
    <h3>Promoted products</h3>
    <p>Up to {blogProductLimit} products appear inside the article as the reader scrolls.</p>
    <div className="blog-product-chosen">
      {chosen.length ? chosen.map((item) => <article key={item.id}>
        {item.imageUrl ? <img src={item.imageUrl} alt=""/> : <span><Package/></span>}
        <div><strong>{item.name}</strong><small>KES {Number(item.discountPrice ?? item.price).toLocaleString()}</small></div>
        <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onChange(selected.filter((id) => id !== item.id))}><X/></button>
      </article>) : <p className="blog-product-empty">No products tagged yet.</p>}
    </div>
    <label className="blog-product-search">
      <Search/>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={full ? `Remove one to add another` : "Search products to tag"} disabled={full}/>
    </label>
    {!full && matches.length > 0 && <div className="blog-product-results">
      {matches.map((item) => <button type="button" key={item.id} onClick={() => { onChange([...selected, item.id]); setQuery(""); }}>
        {item.imageUrl ? <img src={item.imageUrl} alt=""/> : <span><Package/></span>}
        <span><strong>{item.name}</strong><small>KES {Number(item.discountPrice ?? item.price).toLocaleString()}</small></span>
      </button>)}
    </div>}
    {!full && query.trim() && matches.length === 0 && <p className="blog-product-empty">No matching products.</p>}
  </div>;
}
