"use client";

import { Heart, Minus, Plus, Share2, ShoppingBag, ShoppingCart } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ProductActions({ productId, productName, productUrl }: { productId:number; productName:string; productUrl:string }) {
  const [quantity, setQuantity] = useState(1);
  const [shareOpen,setShareOpen]=useState(false);
  const [copied,setCopied]=useState(false);
  const [nativeShare,setNativeShare]=useState(false);
  const shareMenu=useRef<HTMLDivElement>(null);
  const encodedUrl=encodeURIComponent(productUrl),encodedText=encodeURIComponent(`${productName} — ${productUrl}`);

  useEffect(()=>{
    setNativeShare(typeof navigator.share==="function");
    const close=(event:PointerEvent)=>{if(!shareMenu.current?.contains(event.target as Node))setShareOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setShareOpen(false)};
    document.addEventListener("pointerdown",close);
    document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape)};
  },[]);

  async function copyLink(){await navigator.clipboard.writeText(productUrl);setCopied(true);setTimeout(()=>setCopied(false),1600)}
  async function shareMore(){try{await navigator.share({title:productName,text:productName,url:productUrl});setShareOpen(false)}catch{} }

  return <div className="product-actions compact-product-actions">
    <form action="/api/cart" method="post">
      <input type="hidden" name="productId" value={productId}/><input type="hidden" name="return" value={`/products/${productId}`}/>
      <span className="quantity-stepper">
        <button type="button" onClick={() => setQuantity(value => Math.max(1, value - 1))} aria-label="Decrease quantity"><Minus/></button>
        <input name="quantity" type="number" min="1" max="99" inputMode="numeric" value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))} aria-label="Quantity"/>
        <button type="button" onClick={() => setQuantity(value => Math.min(99, value + 1))} aria-label="Increase quantity"><Plus/></button>
      </span>
      <button className="primary-cart-action" type="submit"><ShoppingCart/><span>Add to cart</span></button>
    </form>
    <a className="icon-product-action view-cart-action" href="/cart" aria-label="View cart" title="View cart"><ShoppingBag/></a>
    <form className="icon-action-form" action="/api/wishlist" method="post"><input type="hidden" name="productId" value={productId}/><input type="hidden" name="return" value={`/products/${productId}`}/><button className="icon-product-action wishlist-product-action" type="submit" aria-label="Add to wishlist" title="Wishlist"><Heart/></button></form>
    <div className="product-share-menu" ref={shareMenu}>
      <button className="icon-product-action share-product-action" type="button" onClick={()=>setShareOpen(open=>!open)} aria-label={`Share ${productName}`} aria-expanded={shareOpen} title="Share"><Share2/></button>
      {shareOpen&&<div className="product-share-popover" role="menu">
        <button type="button" onClick={copyLink}>{copied?"Link copied":"Copy link"}</button>
        <a href={`https://wa.me/?text=${encodedText}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`} target="_blank" rel="noreferrer">Facebook</a>
        <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(productName)}&url=${encodedUrl}`} target="_blank" rel="noreferrer">X</a>
        <a href={`mailto:?subject=${encodeURIComponent(productName)}&body=${encodedText}`}>Email</a>
        {nativeShare&&<button type="button" onClick={shareMore}>More apps</button>}
      </div>}
    </div>
  </div>;
}
