"use client";

import { Heart, Minus, Plus, Share2, ShoppingBag, ShoppingCart } from "lucide-react";
import { useState } from "react";

export function ProductActions({ productId, productName, productUrl }: { productId:number; productName:string; productUrl:string }) {
  const [quantity, setQuantity] = useState(1);
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(`${productName} — ${productUrl}`)}`;
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
    <a className="icon-product-action share-product-action" href={shareUrl} target="_blank" rel="noreferrer" aria-label={`Share ${productName}`} title="Share"><Share2/></a>
  </div>;
}
