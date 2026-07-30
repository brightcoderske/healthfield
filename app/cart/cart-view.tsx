"use client";

import { ArrowLeft, Minus, Package, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  price: string;
  discountPrice: string | null;
  imageUrl: string | null;
  packSize: string | null;
};

export function CartView({ initialCatalog, initialCart }: { initialCatalog: Product[]; initialCart: Record<number, number> }) {
  const catalog = initialCatalog;
  const [cart] = useState<Record<number, number>>(initialCart);

  const lines = useMemo(
    () => Object.entries(cart)
      .map(([id, quantity]) => ({ product: catalog.find((product) => product.id === Number(id)), quantity }))
      .filter((line): line is { product: Product; quantity: number } => Boolean(line.product)),
    [cart, catalog],
  );
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const subtotal = lines.reduce(
    (sum, line) => sum + Number(line.product.discountPrice ?? line.product.price) * line.quantity,
    0,
  );

  return (
    <main className="cart-page">
      <header>
        <a href="/#products"><ArrowLeft /> Continue shopping</a>
        <h1>Your cart</h1>
        <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
      </header>
      <div className="cart-layout">
        <section>
          {lines.length === 0 ? (
            <div className="database-empty"><ShoppingCart /><strong>Your cart is empty</strong><a href="/#products">Browse products</a></div>
          ) : lines.map((line) => (
            <article key={line.product.id}>
              <a href={`/products/${line.product.id}`} className="cart-image">
                {line.product.imageUrl ? <img src={line.product.imageUrl} alt={line.product.name} /> : <Package />}
              </a>
              <div>
                <a href={`/products/${line.product.id}`}><strong>{line.product.name}</strong></a>
                {line.product.packSize && <small>{line.product.packSize}</small>}
                <b>KES {Number(line.product.discountPrice ?? line.product.price).toLocaleString()}</b>
              </div>
              <div className="cart-quantity">
                <form action="/api/cart" method="post"><input type="hidden" name="productId" value={line.product.id}/><input type="hidden" name="action" value="set"/><input type="hidden" name="quantity" value={line.quantity-1}/><input type="hidden" name="return" value="/cart"/><button type="submit" aria-label={`Reduce ${line.product.name} quantity`}><Minus /></button></form>
                <span>{line.quantity}</span>
                <form action="/api/cart" method="post"><input type="hidden" name="productId" value={line.product.id}/><input type="hidden" name="action" value="set"/><input type="hidden" name="quantity" value={line.quantity+1}/><input type="hidden" name="return" value="/cart"/><button type="submit" aria-label={`Increase ${line.product.name} quantity`}><Plus /></button></form>
              </div>
              <form action="/api/cart" method="post" className="cart-remove-form"><input type="hidden" name="productId" value={line.product.id}/><input type="hidden" name="action" value="remove"/><input type="hidden" name="return" value="/cart"/><button type="submit" className="cart-remove" aria-label={`Remove ${line.product.name}`}><Trash2 /></button></form>
            </article>
          ))}
        </section>
        <aside>
          <h2>Cart summary</h2>
          <span>Subtotal<strong>KES {subtotal.toLocaleString()}</strong></span>
          <p>Delivery is calculated during checkout.</p>
          <a className={lines.length ? "" : "disabled"} href={lines.length ? "/checkout" : "#"}>Proceed to checkout</a>
        </aside>
      </div>
    </main>
  );
}
