import { Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
export const dynamic = "force-dynamic";

type AccountData = {
  orders: Array<{ id:number; orderNumber:string; createdAt:string; fulfilmentMethod:string; status:string; total:string }>;
  catalog: Array<{ id:number; name:string; imageUrl:string|null; packSize:string|null; price:string; discountPrice:string|null }>;
};

export default async function AccountPage() {
  const session = await requireRole(["CUSTOMER"]);
  const { orders, catalog } = await backendJson<AccountData>("/v1/views/account");
  const actions = [{href:"#orders",label:"Orders"},{href:"/chat",label:"Chat"},{href:"/prescriptions/upload",label:"Prescription"},{href:"/wishlist",label:"Favourites"},{href:"#addresses",label:"Addresses"}];
  return <main className="customer-account compact-account">
    <header><Link href="/#products">← Continue shopping</Link><form action="/api/auth/logout" method="post"><button>Sign out</button></form></header>
    <div className="account-welcome"><span>My Healthfield</span><h1>Hello, {session.firstName}</h1><p>Shop, track orders and get help from our pharmacy team.</p></div>
    <nav className="account-quick-links">{actions.map(({href,label})=><Link href={href} key={label}>{label}</Link>)}</nav>
    <section className="account-orders" id="orders"><div><h2>My orders</h2><Link href="/#products">Shop more</Link></div>{orders.length?orders.map(order=><Link href={`/account/orders/${order.id}`} key={order.id}><span><strong>{order.orderNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString()} · {order.fulfilmentMethod==="DELIVERY"?"Delivery":"Pickup"}</small></span><em>{order.status.replaceAll("_"," ")}</em><b>KES {Number(order.total).toLocaleString()}</b></Link>):<div className="account-empty"><Package/><span><strong>No orders yet</strong><small>Your first order will appear here.</small></span><Link href="/#products">Start shopping</Link></div>}</section>
    <section className="account-products"><header><div><h2>Continue shopping</h2><p>Popular health essentials selected for you.</p></div><Link href="/#products">View all products</Link></header><div>{catalog.map(product=><article key={product.id}><Link href={`/products/${product.id}`}><div>{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<Package/>}</div><strong>{product.name}</strong><small>{product.packSize||"Healthfield Pharmacy"}</small></Link><footer><b>KES {Number(product.discountPrice??product.price).toLocaleString()}</b><form action="/api/cart" method="post"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="action" value="add"/><input type="hidden" name="return" value="/account"/><button aria-label={`Add ${product.name} to cart`}><ShoppingCart/></button></form></footer></article>)}</div></section>
  </main>;
}
