"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent,useMemo,useState } from "react";
import { Boxes,Package,Search,X } from "lucide-react";

type StoreStock={id:number;productId:number;branchId:number;branch:string;available:number;reserved:number;reorder:number};
type Product={id:number;name:string;imageUrl:string|null;brand:string|null;packSize:string|null;isActive:boolean;sold:number;stores:StoreStock[]};

export function InventoryManager({initialProducts,backHref="/admin",scopeLabel="every store"}:{initialProducts:Product[];backHref?:string;scopeLabel?:string}){
  const [rows,setRows]=useState(initialProducts),[query,setQuery]=useState(""),[editing,setEditing]=useState<Product|null>(null),[saving,setSaving]=useState<number|null>(null),[error,setError]=useState("");
  const shown=useMemo(()=>rows.filter(row=>`${row.name} ${row.brand||""}`.toLowerCase().includes(query.toLowerCase())),[rows,query]);
  async function saveStore(event:FormEvent<HTMLFormElement>,stock:StoreStock){
    event.preventDefault();
    const form=new FormData(event.currentTarget),payload={quantityAvailable:Number(form.get("available")),quantityReserved:Number(form.get("reserved")),reorderLevel:Number(form.get("reorder"))};
    setSaving(stock.id);setError("");
    try{
      const response=await fetch(`/api/inventory/${stock.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),data=await response.json();
      if(!response.ok)return setError(data.error||"Stock could not be updated.");
      setRows(current=>current.map(product=>product.id===stock.productId?{...product,stores:product.stores.map(item=>item.id===stock.id?{...item,available:payload.quantityAvailable,reserved:payload.quantityReserved,reorder:payload.reorderLevel}:item)}:product));
      setEditing(current=>current?{...current,stores:current.stores.map(item=>item.id===stock.id?{...item,available:payload.quantityAvailable,reserved:payload.quantityReserved,reorder:payload.reorderLevel}:item)}:current);
    }finally{setSaving(null)}
  }
  return <main className="compact-admin-page"><header><div><a href={backHref}>← Dashboard</a><h1>Inventory</h1><p>Stock, reservations and sales for {scopeLabel}.</p></div></header><div className="compact-table-tools"><label><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search product or brand"/></label><span>{shown.length} products</span></div><div className="compact-table"><div className="compact-table-head inventory-product-row"><span>Image</span><span>Product</span><span>Available</span><span>Reserved</span><span>Sold</span><span>Stores</span></div>{shown.map(product=>{const available=product.stores.reduce((sum,store)=>sum+store.available,0),reserved=product.stores.reduce((sum,store)=>sum+store.reserved,0);return <div className="compact-table-row inventory-product-row" key={product.id}><span className="table-thumb">{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</span><span><button className="row-link" onClick={()=>setEditing(product)}>{product.name}</button><small>{product.brand||"No brand"}{product.packSize?` · ${product.packSize}`:""}</small></span><strong>{available}</strong><span>{reserved}</span><b>{product.sold}</b><span>{product.stores.length}</span></div>})}</div>{editing&&<div className="product-modal inventory-modal" onClick={()=>setEditing(null)}><section onClick={event=>event.stopPropagation()}><header><div><h2>{editing.name}</h2><p>{editing.sold} units ordered so far · {editing.stores.reduce((sum,store)=>sum+store.available,0)} available</p></div><button onClick={()=>setEditing(null)}><X/></button></header>{editing.stores.length===0?<div className="database-empty"><Boxes/><strong>No shop inventory yet</strong><span>This product does not have an inventory record for the selected shop.</span></div>:<div className="inventory-store-list">{editing.stores.map(stock=><form key={stock.id} onSubmit={event=>saveStore(event,stock)} className={saving===stock.id?"row-saving":""}><strong>{stock.branch}</strong><label>Available<input name="available" type="number" min="0" defaultValue={stock.available}/></label><label>Reserved<input name="reserved" type="number" min="0" defaultValue={stock.reserved}/></label><label>Reorder at<input name="reorder" type="number" min="0" defaultValue={stock.reorder}/></label><button disabled={saving===stock.id}>{saving===stock.id?"Saving…":"Update"}</button></form>)}</div>}{error&&<div className="auth-error">{error}</div>}</section></div>}</main>;
}
