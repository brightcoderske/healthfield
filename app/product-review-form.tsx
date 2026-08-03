"use client";
import { FormEvent, useState } from "react";
const labels = ["", "Poor", "Fair", "Good", "Very good", "Recommend"];
export function ProductReviewForm({ productId }: { productId: number }) {
  const [rating,setRating]=useState(5),[message,setMessage]=useState(""),[saving,setSaving]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);const form=new FormData(event.currentTarget);const response=await fetch(`/api/products/${productId}/reviews`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rating,comment:String(form.get("comment"))})}),data=await response.json().catch(()=>({}));setMessage(data.message||data.error||"Review could not be saved.");setSaving(false);if(response.ok)setTimeout(()=>location.reload(),700)}
  return <form className="review-form" onSubmit={submit}><h3>Rate this product</h3><div className="review-stars">{[1,2,3,4,5].map(value=><button type="button" key={value} className={value<=rating?"selected":""} onClick={()=>setRating(value)} aria-label={`${value} stars`}>★</button>)}<strong>{labels[rating]}</strong></div><textarea name="comment" required minLength={3} maxLength={1200} placeholder="How was the product?"/><button disabled={saving}>{saving?"Saving…":"Submit verified review"}</button>{message&&<p>{message}</p>}</form>
}
