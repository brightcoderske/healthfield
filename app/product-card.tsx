"use client";

import { Heart, Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";

export type ProductCardProduct = { id:number; name:string; imageUrl:string|null; price:number|string; discountPrice:number|string|null; rating?:number|null; reviewCount?:number };

export function ProductCard({ product, wishlistActive=false, cartQuantity=0, returnTo, onAddToCart }: { product:ProductCardProduct; wishlistActive?:boolean; cartQuantity?:number; returnTo:string; onAddToCart?:(event:FormEvent<HTMLFormElement>, productId:number)=>void }) {
  const regularPrice=Number(product.price), discountPrice=product.discountPrice===null?null:Number(product.discountPrice), sellingPrice=discountPrice??regularPrice;
  const discount=discountPrice!==null&&regularPrice>discountPrice?Math.round((1-discountPrice/regularPrice)*100):0;
  return <article className="approved-product">
    <Link prefetch={false} className="approved-product-main" href={`/products/${product.id}`} aria-label={`View ${product.name}`}>
      <div className="approved-product-image">{discount>0&&<span className="discount-badge">Save {discount}%</span>}{product.imageUrl?<img src={product.imageUrl} alt={product.name} loading="lazy" decoding="async"/>:<div className="product-image-missing"><Package/><small>Image pending</small></div>}</div>
      <div className="approved-product-info"><h3>{product.name}</h3>{!!product.rating&&<div className="approved-rating" aria-label={`${product.rating.toFixed(1)} from ${product.reviewCount??0} reviews`}>★ {product.rating.toFixed(1)} <small>({product.reviewCount??0})</small></div>}</div>
    </Link>
    <form action="/api/wishlist" method="post" className="product-wishlist-form"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="return" value={returnTo}/><button type="submit" className={`approved-wishlist ${wishlistActive?"active":""}`} aria-label={`Save ${product.name}`}><Heart/></button></form>
    <div className="product-card-footer"><span className="product-card-prices"><strong>KES {Math.round(sellingPrice).toLocaleString("en-KE")}</strong>{discount>0&&<del>KES {Math.round(regularPrice).toLocaleString("en-KE")}</del>}</span><form action="/api/cart" method="post" onSubmit={onAddToCart?(event)=>onAddToCart(event,product.id):undefined}><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="action" value="add"/><input type="hidden" name="return" value={returnTo}/><button type="submit" className="approved-cart" aria-label={`Add ${product.name} to cart`}>{cartQuantity?<b>{cartQuantity}</b>:<ShoppingCart/>}</button></form></div>
  </article>;
}
