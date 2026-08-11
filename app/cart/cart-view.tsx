"use client";

import { ArrowLeft, Minus, Package, Plus, ShoppingCart, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  price: string;
  discountPrice: string | null;
  imageUrl: string | null;
  packSize: string | null;
};

export type CartOffer = { id: number; title: string; total: number; items: Array<{ productId: number; name: string; quantity: number }> };

export function CartView({ initialCatalog, initialCart, initialOffers = [] }: { initialCatalog: Product[]; initialCart: Record<number, number>; initialOffers?: CartOffer[] }) {
  const catalog = initialCatalog;
  const [cart] = useState<Record<number, number>>(initialCart);

  const lines = useMemo(
    () => Object.entries(cart)
      .map(([id, quantity]) => ({ product: catalog.find((product) => product.id === Number(id)), quantity }))
      .filter((line): line is { product: Product; quantity: number } => Boolean(line.product)),
    [cart, catalog],
  );
  // A bundle is one basket item however many products it contains.
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0) + initialOffers.length;
  const subtotal = lines.reduce(
    (sum, line) => sum + Number(line.product.discountPrice ?? line.product.price) * line.quantity,
    0,
  ) + initialOffers.reduce((sum, offer) => sum + Number(offer.total), 0);
  const hasContents = lines.length > 0 || initialOffers.length > 0;

  return (
    <main className="cart-page">
      <header>
        <a href="/#products"><ArrowLeft /> Continue shopping</a>
        <h1>Your cart</h1>
        <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
      </header>
      <div className="cart-layout">
        <section>
          {initialOffers.map((offer) => (
            <article key={`offer-${offer.id}`} className="cart-bundle">
              <span className="cart-image cart-bundle-badge"><Tag /></span>
              <div>
                <strong>{offer.title}</strong>
                <small>{offer.items.map((item) => `${item.quantity > 1 ? `${item.quantity} × ` : ""}${item.name}`).join(" + ")}</small>
                <b>KES {Number(offer.total).toLocaleString()}</b>
              </div>
              <div className="cart-quantity cart-bundle-quantity"><span>1</span><small>bundle</small></div>
              <form action="/api/cart" method="post" className="cart-remove-form"><input type="hidden" name="offerId" value={offer.id}/><input type="hidden" name="action" value="remove"/><input type="hidden" name="return" value="/cart"/><button type="submit" className="cart-remove" aria-label={`Remove ${offer.title}`}><Trash2 /></button></form>
            </article>
          ))}
          {!hasContents ? (
            <div className="database-empty"><ShoppingCart /><strong>Your cart is empty</strong><a href="/#products">Browse products</a></div>
          ) : null}
          {lines.map((line) => (
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
          <a className={hasContents ? "" : "disabled"} href={hasContents ? "/checkout" : "#"}>Proceed to checkout</a>
        </aside>
      </div>
    </main>
  );
}
