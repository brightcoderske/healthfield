"use client";

import { ClipboardList, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./order-list.module.css";

type Order={id:number;orderNumber:string;customerName:string;phone:string;status:string;createdAt:string;paymentStatus:string;paymentMethod:string;amountPaid:string;fulfilmentMethod:string;total:string;deliveryArea:string|null};
const removable=new Set(["NEW","CONFIRMED","UNDER_REVIEW","CANCELLED"]);
const paymentName=(method:string)=>method==="MPESA_EXPRESS"?"M-Pesa Express":method==="MANUAL_MPESA"?"Manual M-Pesa":"Cash";

export function OrderList({orders}:{orders:Order[]}){
  const [q,setQ]=useState(""),[rows,setRows]=useState(orders),[open,setOpen]=useState<number|null>(null),[message,setMessage]=useState("");
  const shown=useMemo(()=>rows.filter((order)=>`${order.orderNumber} ${order.customerName} ${order.phone} ${order.paymentMethod} ${order.paymentStatus}`.toLowerCase().includes(q.toLowerCase())),[rows,q]);
  async function remove(order:Order){
    if(!confirm(`Delete ${order.orderNumber}? This permanently removes the order and its items.`))return;
    const response=await fetch(`/api/orders/${order.id}`,{method:"DELETE"}),data=await response.json().catch(()=>({}));
    if(!response.ok)return setMessage(data.error||"Order could not be deleted.");
    setRows((current)=>current.filter((value)=>value.id!==order.id));setOpen(null);setMessage(`${order.orderNumber} deleted.`)
  }
  return <><div className="compact-table-tools admin-data-tools"><label><Search/><input value={q} onChange={(event)=>setQ(event.target.value)} placeholder="Search order, customer, phone or payment"/></label><span>{shown.length} records</span></div>{message&&<div className="form-message">{message}</div>}<div className={styles.scroller}><section className={`admin-search-table ${styles.table}`} onClick={()=>setOpen(null)}><div className="admin-search-head"><span>Order & customer</span><span>Status</span><span>Payment</span><span>Fulfilment</span><span>Total</span><span>Actions</span></div>{shown.length?shown.map((order)=><article key={order.id}><div><a className="row-link" href={`/admin/orders/${order.id}`}>{order.orderNumber}</a><small>{order.customerName} · {order.phone}</small></div><div><strong>{order.status.replaceAll("_"," ")}</strong><small>{new Date(order.createdAt).toLocaleDateString()}</small></div><div><strong className={`payment-type payment-type-${order.paymentMethod.toLowerCase()}`}>{paymentName(order.paymentMethod)}</strong><small>{order.paymentStatus}</small></div><div><strong>{order.fulfilmentMethod}</strong><small>{order.deliveryArea||"No area"}</small></div><strong>KES {Number(order.total).toLocaleString()}</strong><div className={styles.actions}><button aria-label="Order actions" onClick={(event)=>{event.stopPropagation();setOpen(open===order.id?null:order.id)}}><MoreHorizontal/></button>{open===order.id&&<div onClick={(event)=>event.stopPropagation()}><a href={`/admin/orders/${order.id}`}>Open order</a>{removable.has(order.status)&&<button onClick={()=>remove(order)}><Trash2/> Delete order</button>}</div>}</div></article>):<div className="database-empty"><ClipboardList/><strong>No matching orders</strong></div>}</section></div></>
}
