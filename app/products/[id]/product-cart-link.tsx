"use client";

import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export const CART_UPDATED_EVENT="healthfield:cart-updated";

export function ProductCartLink({initialCount}:{initialCount:number}){
  const [count,setCount]=useState(initialCount);
  useEffect(()=>{
    const update=(event:Event)=>setCount(Math.max(0,Number((event as CustomEvent<{count:number}>).detail?.count)||0));
    window.addEventListener(CART_UPDATED_EVENT,update);
    return()=>window.removeEventListener(CART_UPDATED_EVENT,update);
  },[]);
  return <Link className="product-header-cart" href="/cart"><ShoppingCart/>{count>0?<b aria-label={`${count} items in cart`}>{count>99?"99+":count}</b>:null}<span>View cart</span></Link>;
}
