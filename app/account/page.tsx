import { desc,eq } from "drizzle-orm";
import { Package,ShoppingCart } from "lucide-react";
import { getDb } from "@/db";
import { orders,products } from "@/db/schema";
import { requireRole } from "@/lib/auth";
export const dynamic="force-dynamic";

export default async function AccountPage(){
  const session=await requireRole(["CUSTOMER"]),db=getDb();
  const [rows,catalog]=await Promise.all([
    db.select().from(orders).where(eq(orders.customerId,session.userId)).orderBy(desc(orders.createdAt)),
    db.select({id:products.id,name:products.name,imageUrl:products.imageUrl,packSize:products.packSize,price:products.price,discountPrice:products.discountPrice}).from(products).where(eq(products.isActive,true)).orderBy(desc(products.isFeatured),desc(products.createdAt)).limit(24),
  ]);
  const actions=[{href:"#orders",label:"Orders"},{href:"/chat",label:"Chat"},{href:"/prescriptions/upload",label:"Prescription"},{href:"/wishlist",label:"Favourites"},{href:"#addresses",label:"Addresses"}];
  return <main className="customer-account compact-account">
    <header><a href="/#products">← Continue shopping</a><form action="/api/auth/logout" method="post"><button>Sign out</button></form></header>
    <div className="account-welcome"><span>My Healthfield</span><h1>Hello, {session.firstName}</h1><p>Shop, track orders and get help from our pharmacy team.</p></div>
    <nav className="account-quick-links">{actions.map(({href,label})=><a href={href} key={label}>{label}</a>)}</nav>
    <section className="account-orders" id="orders"><div><h2>My orders</h2><a href="/#products">Shop more</a></div>{rows.length?rows.map(order=><a href={`/account/orders/${order.id}`} key={order.id}><span><strong>{order.orderNumber}</strong><small>{order.createdAt.toLocaleDateString()} · {order.fulfilmentMethod==="DELIVERY"?"Delivery":"Pickup"}</small></span><em>{order.status.replaceAll("_"," ")}</em><b>KES {Number(order.total).toLocaleString()}</b></a>):<div className="account-empty"><Package/><span><strong>No orders yet</strong><small>Your first order will appear here.</small></span><a href="/#products">Start shopping</a></div>}</section>
    <section className="account-products"><header><div><h2>Continue shopping</h2><p>Popular health essentials selected for you.</p></div><a href="/#products">View all products</a></header><div>{catalog.map(product=><article key={product.id}><a href={`/products/${product.id}`}><div>{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</div><strong>{product.name}</strong><small>{product.packSize||"Healthfield Pharmacy"}</small></a><footer><b>KES {Number(product.discountPrice??product.price).toLocaleString()}</b><form action="/api/cart" method="post"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="action" value="add"/><input type="hidden" name="return" value="/account"/><button aria-label={`Add ${product.name} to cart`}><ShoppingCart/></button></form></footer></article>)}</div></section>
  </main>
}
