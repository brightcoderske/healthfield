"use client";
import { FormEvent,useState } from "react";
type Item={id:number;name:string;description?:string|null;featuredOnStorefront?:boolean};
const featuredLimit=6;
function List({title,kind,initial}:{title:string;kind:"categories"|"conditions";initial:Item[]}){
  const [items,setItems]=useState(initial),[message,setMessage]=useState(""),[saving,setSaving]=useState<number|null>(null);
  const featuredCount=items.filter(item=>item.featuredOnStorefront).length;
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget,data=new FormData(form),featured=kind==="categories"&&data.get("featured")==="on";
    if(featured&&featuredCount>=featuredLimit)return setMessage(`You can only feature ${featuredLimit} categories on the storefront. Unfeature one first.`);
    const payload={name:String(data.get("name")),description:String(data.get("description")||""),...(kind==="categories"?{featured}:{})};
    const res=await fetch(`/api/${kind}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),body=await res.json().catch(()=>({}));
    if(!res.ok)return setMessage(body.error||"Could not save.");
    setMessage("");setItems(rows=>[...rows,{id:body.id,name:payload.name,description:payload.description,featuredOnStorefront:featured}]);form.reset()
  }
  async function toggleFeatured(item:Item){
    const next=!item.featuredOnStorefront;
    if(next&&featuredCount>=featuredLimit)return setMessage(`You can only feature ${featuredLimit} categories on the storefront. Unfeature one first.`);
    setSaving(item.id);
    const res=await fetch(`/api/${kind}/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:item.name,description:item.description||"",featured:next})}),body=await res.json().catch(()=>({}));
    setSaving(null);
    if(!res.ok)return setMessage(body.error||"Could not update the storefront selection.");
    setMessage("");setItems(rows=>rows.map(row=>row.id===item.id?{...row,featuredOnStorefront:next}:row))
  }
  async function edit(item:Item){
    const name=window.prompt(`Rename ${title.slice(0,-1)}`,item.name);if(!name)return;
    const res=await fetch(`/api/${kind}/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,description:item.description||""})});
    if(res.ok)setItems(rows=>rows.map(row=>row.id===item.id?{...row,name}:row))
  }
  async function remove(item:Item){
    if(!window.confirm(`Remove ${item.name}? Products already using it keep their historical relation.`))return;
    const res=await fetch(`/api/${kind}/${item.id}`,{method:"DELETE"});
    if(res.ok)setItems(rows=>rows.filter(row=>row.id!==item.id))
  }
  return <section className="taxonomy-card"><header><h2>{title}</h2><span>{items.length} records</span></header>
    <form onSubmit={submit}>
      <input name="name" placeholder={`New ${title.slice(0,-1).toLowerCase()}`} required/>
      <input name="description" placeholder={kind==="conditions"?"Optional description":"Not needed for categories"} disabled={kind==="categories"}/>
      {kind==="categories"&&<label className="taxonomy-featured-field"><input type="checkbox" name="featured" disabled={featuredCount>=featuredLimit}/><span>Show on storefront</span></label>}
      <button>Add</button>
    </form>
    {kind==="categories"&&<p className="taxonomy-featured-hint">{featuredCount} of {featuredLimit} storefront slots used{featuredCount>=featuredLimit?" — unfeature one to choose a different category.":"."}</p>}
    {message&&<p className="taxonomy-featured-error" role="alert">{message}</p>}
    <div className={`taxonomy-table${kind==="categories"?" has-featured":""}`}><div className="taxonomy-table-head"><span>Name</span>{kind==="categories"&&<span>Storefront</span>}<span>Actions</span></div>
      {items.map(item=><article key={item.id}>
        <span><b>{item.name}</b>{item.description&&<small>{item.description}</small>}</span>
        {kind==="categories"&&<span><label className="taxonomy-featured-toggle"><input type="checkbox" checked={Boolean(item.featuredOnStorefront)} disabled={saving===item.id||(!item.featuredOnStorefront&&featuredCount>=featuredLimit)} onChange={()=>toggleFeatured(item)}/><span>{item.featuredOnStorefront?"Featured":"Hidden"}</span></label></span>}
        <span><button onClick={()=>edit(item)}>Edit</button><button onClick={()=>remove(item)}>Delete</button></span>
      </article>)}
    </div>
  </section>
}
export function TaxonomyManager({initialCategories,initialConditions}:{initialCategories:Item[];initialConditions:Item[]}){return <main className="data-page taxonomy-page"><header><a href="/admin">← Dashboard</a><h1>Categories/Conditions</h1></header><div className="taxonomy-grid"><List title="Categories" kind="categories" initial={initialCategories}/><List title="Conditions" kind="conditions" initial={initialConditions}/></div></main>}
