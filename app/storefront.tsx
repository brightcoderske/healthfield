"use client";

import {
  Baby,
  CircleUserRound,
  HeartPulse,
  Menu,
  Package,
  Pill,
  Search,
  ShoppingCart,
  Sparkles,
  Truck,
  ShieldCheck,
  Phone,
  Upload,
  Users,
  Heart,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  imageUrl: string | null;
  packSize: string | null;
  brand: string | null;
  categoryId: number;
  shortDescription: string | null;
  conditionIds: number[];
  rating: number | null;
  reviewCount: number;
  discountPrice: number | null;
};
type CatalogCategory = { id: number; name: string; slug: string };
type HealthCondition = { id: number; name: string; slug: string };

const categoryPresentation = [
  { icon: Upload, color: "green" },
  { icon: Pill, color: "purple" },
  { icon: Sparkles, color: "pink" },
  { icon: Package, color: "blue" },
  { icon: HeartPulse, color: "pink" },
  { icon: Package, color: "green" },
];

// Keep server and phone output identical; mobile ICU data can format KES differently.
function formatKes(value: number) {
  const rounded = Math.round(value).toString();
  return `KES ${rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function Storefront({ initialProducts, initialCategories, initialConditions, contact, viewer, offersOnly, initialCart, initialWishlist }: { initialProducts: CatalogProduct[]; initialCategories: CatalogCategory[]; initialConditions: HealthCondition[]; contact: { phone: string; whatsapp: string; deliveryMessage: string }; viewer: { firstName: string; role: string } | null; offersOnly: boolean; initialCart: Record<number, number>; initialWishlist: number[] }) {
  const [query, setQuery] = useState("");
  const [cart] = useState<Record<number, number>>(initialCart);
  const [wishlist] = useState<number[]>(initialWishlist);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<number | null>(null);
  const [conditionQuery, setConditionQuery] = useState("");
  const productRail = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => initialProducts.filter((product) =>
      product.name.toLowerCase().includes(query.toLowerCase()) &&
      (!selectedCategory || product.categoryId === selectedCategory) &&
      (!selectedCondition || product.conditionIds.includes(selectedCondition)) &&
      (!offersOnly || product.discountPrice !== null)),
    [initialProducts, query, selectedCategory, selectedCondition, offersOnly],
  );
  const displayedCategories = initialCategories.map((category, index) => ({
    ...category,
    ...categoryPresentation[index % categoryPresentation.length],
  }));
  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get("category");
    const match = initialCategories.find((item) => item.slug === category);
    if (match) setSelectedCategory(match.id);
    const condition = new URLSearchParams(window.location.search).get("condition");
    const conditionMatch = initialConditions.find((item) => item.slug === condition);
    if (conditionMatch) setSelectedCondition(conditionMatch.id);
  }, []);
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  return (
    <div className="approved-app">
      <div className="desktop-store">
        <div className="desktop-trust"><span><Truck /> {contact.deliveryMessage}</span><span><ShieldCheck /> 100% Genuine Products</span><span><Package /> Secure Payments</span>{(contact.phone||contact.whatsapp)&&<span><Phone /> Call/WhatsApp: {contact.whatsapp||contact.phone}</span>}<a href="/login"><CircleUserRound/> Login / Register</a><a href="/wishlist"><Heart/> Wishlist ({wishlist.length})</a><a href="/cart"><ShoppingCart /> Cart ({cartCount})</a></div>
        <div className="desktop-brand-row"><a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={250} height={90} priority /></a><label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for medicines, health & wellness products..." /><button><Search /></button></label><a className="desktop-help" href={contact.phone ? `tel:${contact.phone.replace(/\s/g,"")}` : contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g,"")}` : "/admin/settings"}><Phone /><span><small>Need Help?</small><strong>{contact.phone||contact.whatsapp||"Contact pharmacy"}</strong></span></a></div>
        <nav className="desktop-store-nav"><a className={!selectedCategory?"active":""} href="/">Home</a>{displayedCategories.map((category)=><a key={category.id} className={selectedCategory===category.id?"active":""} href={`/?category=${category.slug}#products`}>{category.name}</a>)}<a href="/?offers=1#products">Offers</a></nav>
      </div>
      <header className="approved-topbar">
        <button className="mobile-menu-trigger" popoverTarget="mobile-shop-menu" aria-label="Open menu"><Menu /></button>
          <nav className="mobile-shop-menu" id="mobile-shop-menu" popover="auto">
            <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" /></label>
            <a href="/">Home</a>
            <details>
              <summary><span>Shop by condition</span><ChevronDown /></summary>
              <div>
                <label><Search /><input value={conditionQuery} onChange={(event) => setConditionQuery(event.target.value)} placeholder="Search conditions" /></label>
                {initialConditions.filter((condition) => condition.name.toLowerCase().includes(conditionQuery.toLowerCase())).slice(0, 10).map((condition) => <a key={condition.id} href={`/?condition=${condition.slug}#products`}>{condition.name}</a>)}
                <a href="/conditions">See all conditions →</a>
              </div>
            </details>
            {displayedCategories.map((category) => <a key={category.id} href={`/?category=${category.slug}#products`}>{category.name}</a>)}
            <a href="/?offers=1#products">Offers</a>
            <a href="/?offers=1#products">Campaign offers</a>
            {viewer ? <>
              <a href={viewer.role === "CUSTOMER" ? "/account" : viewer.role === "STAFF" ? "/staff" : "/admin"}>{viewer.firstName}&apos;s account</a>
              <form action="/api/auth/logout" method="post"><button type="submit">Log out</button></form>
            </> : <a href="/login">Log in / Sign up</a>}
          </nav>
        <a className="mobile-logo" href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={215} height={84} priority /></a>
          <div className="public-header-actions"><a href="/login" aria-label="Log in or sign up"><CircleUserRound/></a><a href="/wishlist" aria-label={`Wishlist with ${wishlist.length} products`}><Heart/><b>{wishlist.length}</b></a><a href="/cart" aria-label={`Cart with ${cartCount} products`}><ShoppingCart/><b>{cartCount}</b></a></div>
      </header>

      <main className="approved-content">
        <div className="desktop-hero-row">
          <aside><h2><Menu /> Shop by Category</h2>{displayedCategories.map(({name,icon:Icon,id})=><a href={`#category-${id}`} key={id}><Icon />{name}<span>›</span></a>)}<button>View All Categories →</button></aside>
          <section><div><h1>Your Health,<br/><em>Our Priority</em></h1><p>Quality medicines and health products<br/>delivered to your door.</p><a href="#products">Shop Now →</a></div><Image src="/healthfield-icon.png" alt="" width={340} height={290}/><div className="desktop-hero-trust"><span><Truck /> Fast Delivery</span><span><ShieldCheck /> Secure Payments</span><span><Sparkles /> Genuine Products</span></div></section>
        </div>
        <label className="approved-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products, categories..."
            aria-label="Search products and categories"
          />
        </label>

        <section className="approved-section" id="categories">
          <div className="approved-title"><h1>Categories</h1><a href="#products">View All</a></div>
          <div className="approved-categories">
            <a className="prescription-category-link" href="/prescriptions/upload"><span className="green"><Upload /></span><small>Upload Prescription</small></a>
            {displayedCategories.map(({ id, name, icon: Icon, color }) => (
              <button key={id} id={`category-${id}`} onClick={() => { setSelectedCategory(id); document.getElementById("products")?.scrollIntoView({ behavior: "smooth" }); }}>
                <span className={color}><Icon /></span>
                <small>{name}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="approved-section" id="products">
          <div className="approved-title"><h2>Featured Health Essentials</h2><div className="product-rail-controls"><button type="button" onClick={() => productRail.current?.scrollBy({ left: -440, behavior: "smooth" })} aria-label="Previous products"><ChevronLeft /></button><button type="button" onClick={() => productRail.current?.scrollBy({ left: 440, behavior: "smooth" })} aria-label="More products"><ChevronRight /></button></div></div>
          <div className="approved-products" ref={productRail}>
            {filtered.map((product) => (
              <article className="approved-product" key={product.id}>
                <a className="approved-product-main" href={`/products/${product.id}`} aria-label={`View ${product.name}`}>
                  <div className="approved-product-image">
                    {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="product-image-missing"><Package /><small>Image pending</small></div>}
                  </div>
                  <div className="approved-product-info">
                    <h3>{product.name}</h3>
                    {product.rating && <div className="approved-rating" aria-label={`${product.rating.toFixed(1)} from ${product.reviewCount} reviews`}>★ {product.rating.toFixed(1)} <small>({product.reviewCount})</small></div>}
                  </div>
                </a>
                <form action="/api/wishlist" method="post" className="product-wishlist-form"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="return" value="/#products"/><button type="submit" className={`approved-wishlist ${wishlist.includes(product.id)?"active":""}`} aria-label={`Save ${product.name}`}><Heart/></button></form>
                <div className="product-card-footer"><strong>{formatKes(product.discountPrice ?? product.price)}</strong><form action="/api/cart" method="post"><input type="hidden" name="productId" value={product.id}/><input type="hidden" name="action" value="add"/><input type="hidden" name="return" value="/#products"/><button type="submit" className="approved-cart" aria-label={`Add ${product.name} to cart`}>{cart[product.id] ? <b>{cart[product.id]}</b> : <ShoppingCart />}</button></form></div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <nav className="approved-nav">
        <a className="active" href="/"><HeartPulse /><span>Home</span></a>
        <a href="#categories"><Package /><span>Categories</span></a>
        <a href="/wishlist"><Heart /><span>Wishlist</span></a>
        <a href="/cart"><ShoppingCart /><span>Cart {cartCount ? `(${cartCount})` : ""}</span></a>
        <a href="/login"><CircleUserRound /><span>Account</span></a>
      </nav>

      <button className="approved-services" popoverTarget="healthfield-services" aria-label="Open Healthfield services"><Image src="/healthfield-icon.png" alt="" width={54} height={46} /></button>
        <div className="approved-services-overlay" id="healthfield-services" popover="auto">
          <section aria-label="Healthfield services">
            <header><strong>Healthfield Services</strong></header>
            <a href="/prescriptions/upload"><Upload /> Upload Prescription</a>
            <a href={contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}` : "/login"}><HeartPulse /> Talk to a Pharmacist</a>
            <a href="/account#orders"><Package /> Track an Order</a>
            <a href="/login"><CircleUserRound /> My Account</a>
          </section>
        </div>
    </div>
  );
}
