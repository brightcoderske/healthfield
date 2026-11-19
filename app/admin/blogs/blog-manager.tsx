"use client";import{ArrowLeft,BookOpen,ImagePlus,Pencil,Plus,Save,Trash2,X}from"lucide-react";import{ChangeEvent,FormEvent,useState}from"react";import{useModalViewport}from"@/app/admin/use-modal-viewport";import{RichTextEditor}from"@/app/admin/products/rich-text-editor";import{BlogProductPicker,type PickerProduct}from"./blog-product-picker";type Post={id:number;title:string;excerpt:string;content:string;imageUrl:string|null;metaTitle:string|null;metaDescription:string|null;isPublished:boolean;category?:string|null;productIds?:number[]};const blank:Post={id:0,title:"",excerpt:"",content:"",imageUrl:null,metaTitle:null,metaDescription:null,isPublished:false,category:"",productIds:[]};
// Topics offered in the editor; they become the badges and filters on the blog index.
const blogCategories=["Health Tips","Medicines","Nutrition","Mental Health","Parenting","Lifestyle"];export function BlogManager({initial,products=[],backHref="/admin"}:{initial:Post[];products?:PickerProduct[];backHref?:string}){const[editing,setEditing]=useState<Post|null>(null),[imageFile,setImageFile]=useState<File|null>(null),[preview,setPreview]=useState(""),[message,setMessage]=useState(""),[saving,setSaving]=useState(false),[failed,setFailed]=useState(false),[dirty,setDirty]=useState(false),[tagged,setTagged]=useState<number[]>([]),[posts,setPosts]=useState<Post[]>(initial),[deletingId,setDeletingId]=useState<number|null>(null),[listNote,setListNote]=useState<{text:string;error:boolean}|null>(null);
// Sizes the sheet to what the phone is actually showing, keyboard included, and keeps
// the focused field above it.
useModalViewport(Boolean(editing));
function open(post:Post){setEditing(post);setImageFile(null);setPreview(post.imageUrl||"");setMessage("");setFailed(false);setDirty(false);setTagged(post.productIds||[])}
// A tap on the backdrop is easy to make by accident on a phone, and used to throw the
// article away without a word.
function close(){if(saving)return;if(dirty&&!window.confirm("Close this article without saving? Your changes will be lost."))return;setEditing(null);setDirty(false);setFailed(false);setMessage("")}
// Deleting is for good: the article leaves the blog and the shop, and links to it stop working, so
// the confirmation names it. Unpublishing (untick "Publish article") is the way to hide one for now.
async function remove(post:Post){
  if(deletingId!==null)return;
  if(!window.confirm(`Delete "${post.title||"Untitled article"}" for good?\n\nIt disappears from the blog, and any links to it stop working. This cannot be undone. To hide it for now instead, edit it and untick Publish.`))return;
  setDeletingId(post.id);setListNote(null);
  try{
    const response=await fetch(`/api/blogs/${post.id}`,{method:"DELETE",signal:AbortSignal.timeout(30_000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){setListNote({text:data.error||"The article could not be deleted.",error:true});return}
    setPosts(items=>items.filter(item=>item.id!==post.id));
    setListNote({text:`"${post.title||"Untitled article"}" was deleted.`,error:false});
  }catch{
    setListNote({text:"Could not reach the server, so nothing was deleted. Try again.",error:true});
  }finally{
    setDeletingId(null);
  }
}
function fail(text:string){setFailed(true);setMessage(text);return undefined}function image(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0]||null;if(file&&file.size>2*1024*1024){event.target.value="";return fail("Article images must be 2 MB or smaller.")}setImageFile(file);if(file)setPreview(URL.createObjectURL(file))}async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!editing)return;
  setSaving(true);setFailed(false);setMessage("");
  const form=new FormData(event.currentTarget);
  try{
    let imageUrl=editing.imageUrl;
    if(imageFile){
      const upload=new FormData();upload.set("image",imageFile);
      const response=await fetch("/api/products/image",{method:"POST",body:upload,signal:AbortSignal.timeout(60_000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)return fail(data.error||"Article image could not be uploaded.");
      imageUrl=data.imageUrl;
    }
    const title=String(form.get("title")),excerpt=String(form.get("excerpt"));
    const payload={title,excerpt,content:String(form.get("content")),imageUrl:preview?imageUrl:null,metaTitle:title,metaDescription:excerpt,isPublished:form.get("isPublished")==="on",category:String(form.get("category")||""),productIds:tagged};
    const response=await fetch(editing.id?`/api/blogs/${editing.id}`:"/api/blogs",{signal:AbortSignal.timeout(45_000),method:editing.id?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return fail(data.error||"Article could not be saved.");
    setDirty(false);
    setMessage(editing.id?"Article saved successfully.":"Article created successfully.");
    setTimeout(()=>location.reload(),500);
  }catch(error){
    // Without this the promise simply rejected: the button stayed on "Saving article…"
    // for good and nothing on screen said why, which reads as a save that never works.
    fail(error instanceof Error&&error.name==="TimeoutError"
      ?"Saving timed out. Nothing has been lost — check the connection and press save again."
      :"Could not reach the server. Nothing has been lost — press save again.");
  }finally{
    setSaving(false);
  }
}return <main className="blog-admin polished-blog-admin"><header><div><a href={backHref}><ArrowLeft/> Dashboard</a><span><BookOpen/><div><h1>Blog articles</h1><p>Create formatted, searchable health articles. SEO is generated automatically from the title and summary.</p></div></span></div><button onClick={()=>open(blank)}><Plus/> New article</button></header>{listNote&&<div className={listNote.error?"blog-save-message blog-list-message is-error":"blog-save-message blog-list-message"} role="status">{listNote.text}</div>}<section className="blog-admin-list">{posts.map(item=><article key={item.id}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:<span className="blog-image-placeholder"><BookOpen/></span>}<div><small className={item.isPublished?"published":"draft"}>{item.isPublished?"Published":"Draft"}</small><strong>{item.title}</strong><p>{item.excerpt}</p></div><div className="blog-row-actions"><button type="button" onClick={()=>open(item)}><Pencil/> Edit</button><button type="button" className="blog-row-delete" onClick={()=>remove(item)} disabled={deletingId!==null} aria-label={`Delete ${item.title}`}><Trash2/> {deletingId===item.id?"Deleting…":"Delete"}</button></div></article>)}</section>{editing&&<div className="blog-modal" onClick={close}><form className="blog-editor polished-blog-editor" onSubmit={submit} onInput={()=>setDirty(true)} onInvalidCapture={event=>{
      // A required field the browser refuses to submit is often off screen on a phone,
      // so the press on Save looked like it did nothing at all.
      const field=event.target as HTMLElement;
      field.scrollIntoView?.({block:"center",behavior:"smooth"});
      fail("Fill in the highlighted field, then press save again.");
    }} onClick={event=>event.stopPropagation()}><header><div><small>{editing.id?"Edit health article":"Create health article"}</small><h2>{editing.id?editing.title||"Untitled article":"New article"}</h2></div><button type="button" onClick={close} aria-label="Close editor"><X/></button></header><div className="blog-editor-body"><section><label>Article title<input name="title" defaultValue={editing.title} maxLength={220} required placeholder="A clear, helpful article title"/><small>This becomes the search and SEO title automatically.</small></label><label>Topic<select name="category" defaultValue={editing.category||""}><option value="">No topic</option>{blogCategories.map(name=><option key={name} value={name}>{name}</option>)}</select><small>Shown as the badge on the blog index and used for its filters.</small></label><label>Short summary<textarea name="excerpt" rows={3} maxLength={500} defaultValue={editing.excerpt} required placeholder="Summarise what the reader will learn"/><small>This becomes the search description automatically.</small></label><div className="rich-text-field"><span>Formatted article</span><RichTextEditor name="content" defaultValue={editing.content} rows={15} maxLength={50000} placeholder="Write the full health article…" helper="Use bold, italic, underline and numbered lists"/></div></section><aside><h3>Article image</h3><label className="blog-image-upload">{preview?<img src={preview} alt="Article preview"/>:<><ImagePlus/><strong>Upload cover image</strong><span>JPEG, PNG or WebP · maximum 2 MB</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={image}/></label>{preview&&<button type="button" className="remove-blog-image" onClick={()=>{setImageFile(null);setPreview("")}}>Remove image</button>}<label className="blog-publish-toggle"><input type="checkbox" name="isPublished" defaultChecked={editing.isPublished}/><span><strong>Publish article</strong><small>Visible in Blogs and search engines</small></span></label><BlogProductPicker catalogue={products} selected={tagged} onChange={setTagged}/></aside></div>{message&&<div className={failed?"blog-save-message is-error":"blog-save-message"} role="status">{message}</div>}<footer><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={saving}><Save/>{saving?"Saving article…":"Save article"}</button></footer></form></div>}</main>}
