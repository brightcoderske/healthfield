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
  MessageCircle,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProductCard } from "./product-card";

type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  imageUrl: string | null;
  packSize: string | null;
  brand: string | null;
  categoryId: number;
  shortDescription: string | null;
  description: string | null;
  conditionIds: number[];
  rating: number | null;
  reviewCount: number;
  discountPrice: number | null;
};
type CatalogCategory = { id: number; name: string; slug: string };
type HealthCondition = { id: number; name: string; slug: string };

const categoryPresentation = [
  { icon: Pill, color: "green" },
  { icon: Sparkles, color: "purple" },
  { icon: Sparkles, color: "pink" },
  { icon: Package, color: "blue" },
  { icon: HeartPulse, color: "pink" },
  { icon: Package, color: "green" },
];

export function Storefront({
  initialProducts,
  initialCategories,
  initialConditions,
  contact,
  viewer,
  offersOnly,
  initialCart,
  initialWishlist,
}: {
  initialProducts: CatalogProduct[];
  initialCategories: CatalogCategory[];
  initialConditions: HealthCondition[];
  contact: {
    phone: string;
    whatsapp: string;
    supportEmail: string;
    address: string;
    openingHours: string;
    deliveryMessage: string;
    facebookUrl: string;
    instagramUrl: string;
    xUrl: string;
    tiktokUrl: string;
    licenceTitle: string;
    licenceNumber: string;
    licenceImageUrl: string | null;
  };
  viewer: { firstName: string; role: string } | null;
  offersOnly: boolean;
  initialCart: Record<number, number>;
  initialWishlist: number[];
}) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<number, number>>(initialCart);
  const [wishlist] = useState<number[]>(initialWishlist);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedCondition, setSelectedCondition] = useState<number | null>(
    null,
  );
  const [conditionQuery, setConditionQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const productRail = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      initialProducts.filter(
        (product) =>
          `${product.name} ${product.brand || ""} ${product.shortDescription || ""} ${product.description || ""} ${initialCategories.find((category) => category.id === product.categoryId)?.name || ""}`
            .replace(/<[^>]*>/g, " ")
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (!selectedCategory || product.categoryId === selectedCategory) &&
          (!selectedCondition ||
            product.conditionIds.includes(selectedCondition)) &&
          (!offersOnly || product.discountPrice !== null),
      ),
    [
      initialProducts,
      initialCategories,
      query,
      selectedCategory,
      selectedCondition,
      offersOnly,
    ],
  );
  const orderedCategories = [...initialCategories].sort((left, right) => {
    const isPrescription = (category: CatalogCategory) =>
      `${category.name} ${category.slug}`.toLowerCase().includes("prescription");
    return Number(isPrescription(left)) - Number(isPrescription(right));
  });
  const displayedCategories = orderedCategories.map((category, index) => ({
    ...category,
    ...(`${category.name} ${category.slug}`.toLowerCase().includes("prescription")
      ? { icon: Upload, color: "green" }
      : categoryPresentation[index % categoryPresentation.length]),
  }));
  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get(
      "category",
    );
    const match = initialCategories.find((item) => item.slug === category);
    if (match) setSelectedCategory(match.id);
    const condition = new URLSearchParams(window.location.search).get(
      "condition",
    );
    const conditionMatch = initialConditions.find(
      (item) => item.slug === condition,
    );
    if (conditionMatch) setSelectedCondition(conditionMatch.id);
  }, []);
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(
      ".desktop-hero-row aside button",
    );
    const showAll = () => {
      setSelectedCategory(null);
      setVisibleCount(24);
      document
        .getElementById("categories")
        ?.scrollIntoView({ behavior: "smooth" });
    };
    button?.addEventListener("click", showAll);
    return () => button?.removeEventListener("click", showAll);
  }, []);
  const cartCount = Object.values(cart).reduce(
    (sum, quantity) => sum + quantity,
    0,
  );
  async function addToCart(
    event: React.FormEvent<HTMLFormElement>,
    productId: number,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/cart", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      }),
      data = await response.json().catch(() => null);
    if (response.ok && data?.cart) setCart(data.cart);
    else
      setCart((current) => ({
        ...current,
        [productId]: Math.min(99, (current[productId] || 0) + 1),
      }));
  }

  return (
    <div className="approved-app">
      <div className="store-utility-strip">
        <span><Truck /> {contact.deliveryMessage || "Delivery across Kenya"}</span>
        <a href={contact.phone ? `tel:${contact.phone.replace(/\s/g, "")}` : contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}` : "/contact"}><Phone /> {contact.phone || contact.whatsapp || "Call pharmacy"}</a>
        {contact.licenceNumber && <span><ShieldCheck /> Pharmacy licence: {contact.licenceNumber}</span>}
      </div>
      <div className="desktop-store">
        <div className="desktop-trust">
          <span>
            <ShieldCheck /> 100% Genuine Products
          </span>
          <span>
            <Package /> Secure Payments
          </span>
          {contact.licenceNumber && (
            <span>
              <ShieldCheck /> Pharmacy licence: {contact.licenceNumber}
            </span>
          )}
          <a
            href={
              viewer
                ? viewer.role === "CUSTOMER"
                  ? "/account"
                  : viewer.role === "STAFF"
                    ? "/staff"
                    : "/admin"
                : "/login"
            }
          >
            <CircleUserRound />{" "}
            {viewer ? `Hi, ${viewer.firstName}` : "Login / Register"}
          </a>
          {viewer?.role === "CUSTOMER" && (
            <a href="/account#orders">
              <Package /> My orders
            </a>
          )}
          <a href="/wishlist">
            <Heart /> Wishlist ({wishlist.length})
          </a>
          <a href="/cart">
            <ShoppingCart /> Cart ({cartCount})
          </a>
        </div>
        <div className="desktop-brand-row">
          <a href="/">
            <Image
              src="/healthfield-logo-clean.png"
              alt="Healthfield Pharmacy"
              width={250}
              height={90}
              priority
            />
          </a>
          <label>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSelectedCategory(null); setSelectedCondition(null); setVisibleCount(24); }}
              placeholder="Search for medicines, health & wellness products..."
            />
            <button>
              <Search />
            </button>
          </label>
          <a
            className="desktop-help"
            href={
              contact.phone
                ? `tel:${contact.phone.replace(/\s/g, "")}`
                : contact.whatsapp
                  ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`
                  : "/admin/settings"
            }
          >
            <Phone />
            <span>
              <small>Need Help?</small>
              <strong>
                {contact.phone || contact.whatsapp || "Contact pharmacy"}
              </strong>
            </span>
          </a>
        </div>
        <nav className="desktop-store-nav">
          <a className={!selectedCategory ? "active" : ""} href="/">
            Home
          </a>
          {displayedCategories.map((category) => (
            <a
              key={category.id}
              className={selectedCategory === category.id ? "active" : ""}
              href={`/?category=${category.slug}#products`}
            >
              {category.name}
            </a>
          ))}
          <a href="/?offers=1#products">Offers</a>
          <a href="/blog">Blogs</a>
        </nav>
      </div>
      <header className="approved-topbar">
        <button
          className="mobile-menu-trigger"
          popoverTarget="mobile-shop-menu"
          aria-label="Open menu"
        >
          <Menu />
        </button>
        <nav className="mobile-shop-menu" id="mobile-shop-menu" popover="auto">
          <label>
            <Search />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSelectedCategory(null); setSelectedCondition(null); setVisibleCount(24); }}
              placeholder="Search products"
            />
          </label>
          <a href="/">Home</a>
          <a href="/blog">Blogs &amp; health guide</a>
          <details>
            <summary>
              <span>Shop by condition</span>
              <ChevronDown />
            </summary>
            <div>
              <label>
                <Search />
                <input
                  value={conditionQuery}
                  onChange={(event) => setConditionQuery(event.target.value)}
                  placeholder="Search conditions"
                />
              </label>
              {initialConditions
                .filter((condition) =>
                  condition.name
                    .toLowerCase()
                    .includes(conditionQuery.toLowerCase()),
                )
                .slice(0, 10)
                .map((condition) => (
                  <a
                    key={condition.id}
                    href={`/?condition=${condition.slug}#products`}
                  >
                    {condition.name}
                  </a>
                ))}
              <a href="/conditions">See all conditions →</a>
            </div>
          </details>
          {displayedCategories.map((category) => (
            <a key={category.id} href={`/?category=${category.slug}#products`}>
              {category.name}
            </a>
          ))}
          <a href="/?offers=1#products">Offers</a>
          <a href="/?offers=1#products">Campaign offers</a>
          {viewer ? (
            <>
              <div className="mobile-account-summary">
                <CircleUserRound />
                <span>
                  <small>Signed in</small>
                  <strong>Hello, {viewer.firstName}</strong>
                </span>
              </div>
              <a
                href={
                  viewer.role === "CUSTOMER"
                    ? "/account"
                    : viewer.role === "STAFF"
                      ? "/staff"
                      : "/admin"
                }
              >
                My account
              </a>
              {viewer.role === "CUSTOMER" && (
                <>
                  <a href="/account#orders">My orders</a>
                  <a href="/chat">Chat with us</a>
                  <a href="/prescriptions/upload">Upload prescription</a>
                  <a href="/wishlist">My favourites</a>
                </>
              )}
              <form action="/api/auth/logout" method="post">
                <button type="submit">Log out</button>
              </form>
            </>
          ) : (
            <a href="/login">Log in / Sign up</a>
          )}
        </nav>
        <a className="mobile-logo" href="/">
          <Image
            src="/healthfield-logo-clean.png"
            alt="Healthfield Pharmacy"
            width={215}
            height={84}
            priority
          />
        </a>
        <div className="public-header-actions">
          <a
            href={
              viewer
                ? viewer.role === "CUSTOMER"
                  ? "/account"
                  : viewer.role === "STAFF"
                    ? "/staff"
                    : "/admin"
                : "/login"
            }
            aria-label={
              viewer ? `${viewer.firstName}'s account` : "Log in or sign up"
            }
          >
            <CircleUserRound />
          </a>
          <a
            href="/wishlist"
            aria-label={`Wishlist with ${wishlist.length} products`}
          >
            <Heart />
            <b>{wishlist.length}</b>
          </a>
          <a href="/cart" aria-label={`Cart with ${cartCount} products`}>
            <ShoppingCart />
            <b>{cartCount}</b>
          </a>
        </div>
      </header>

      <main className="approved-content">
        <div className="desktop-hero-row">
          <aside>
            <h2>
              <Menu /> Shop by Category
            </h2>
            {displayedCategories.map(({ name, icon: Icon, id }) => (
              <a href={`#category-${id}`} key={id}>
                <Icon />
                {name}
                <span>›</span>
              </a>
            ))}
            <button>View All Categories →</button>
          </aside>
          <section>
            <div>
              <h1>
                Your Health,
                <br />
                <em>Our Priority</em>
              </h1>
              <p>
                Quality medicines and health products
                <br />
                delivered to your door.
              </p>
              <a href="#products">Shop Now →</a>
            </div>
            <Image
              className="hero-pharmacist"
              src="/healthfield-hero-pharmacist.png"
              alt="Healthfield pharmacist with health and wellness products"
              width={2048}
              height={910}
              priority
            />
            <div className="desktop-hero-trust">
              <span>
                <Truck /> Fast Delivery
              </span>
              <span>
                <ShieldCheck /> Secure Payments
              </span>
              <span>
                <Sparkles /> Genuine Products
              </span>
            </div>
          </section>
        </div>
        <label className="approved-search">
          <Search />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedCategory(null);
              setSelectedCondition(null);
              setVisibleCount(24);
            }}
            placeholder="Search products, categories..."
            aria-label="Search products and categories"
          />
        </label>

        {!query.trim() && <section className="approved-section" id="categories">
          <div className="approved-title">
            <h1>Categories</h1>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(null);
                setVisibleCount(24);
                document
                  .getElementById("products")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              View All
            </button>
          </div>
          <div className="approved-categories">
            <a
              className="prescription-category-link"
              href="/prescriptions/upload"
            >
              <span className="green">
                <Upload />
              </span>
              <small>Upload Prescription</small>
            </a>
            {displayedCategories.map(({ id, name, icon: Icon, color }) => (
              <button
                key={id}
                id={`category-${id}`}
                onClick={() => {
                  setSelectedCategory(id);
                  setVisibleCount(24);
                  document
                    .getElementById("products")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className={color}>
                  <Icon />
                </span>
                <small>{name}</small>
              </button>
            ))}
          </div>
        </section>}

        <section className="approved-section" id="products">
          <div className="approved-title">
            <div>
              <h2>Shop Health &amp; Wellness</h2>
              <small>{filtered.length} products available</small>
            </div>
            <div className="product-rail-controls">
              <button
                type="button"
                onClick={() =>
                  productRail.current?.scrollBy({
                    left: -440,
                    behavior: "smooth",
                  })
                }
                aria-label="Previous products"
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                onClick={() =>
                  productRail.current?.scrollBy({
                    left: 440,
                    behavior: "smooth",
                  })
                }
                aria-label="More products"
              >
                <ChevronRight />
              </button>
            </div>
          </div>
          <div
            className={`approved-products ${selectedCategory || selectedCondition || query || offersOnly ? "catalogue-expanded" : ""}`}
            ref={productRail}
          >
            {filtered.slice(0, visibleCount).map((product) => <ProductCard key={product.id} product={product} wishlistActive={wishlist.includes(product.id)} cartQuantity={cart[product.id]} returnTo="/#products" onAddToCart={addToCart} />)}
          </div>
          {visibleCount < filtered.length && (
            <button
              className="catalogue-show-more"
              type="button"
              onClick={() => setVisibleCount((count) => count + 24)}
            >
              Show more products{" "}
              <span>{Math.min(24, filtered.length - visibleCount)} more</span>
            </button>
          )}
          {(selectedCategory || selectedCondition || query || offersOnly) &&
            filtered.length === 0 && (
              <div className="catalogue-empty">
                <Package />
                <strong>No matching products</strong>
                <span>Try another category or search term.</span>
              </div>
            )}
        </section>
      </main>

      <nav className="approved-nav">
        <a className="active" href="/">
          <HeartPulse />
          <span>Home</span>
        </a>
        <a
          href={
            viewer?.role === "CUSTOMER"
              ? "/account#orders"
              : "/login?next=/account#orders"
          }
        >
          <Package />
          <span>Orders</span>
        </a>
        <a href="/wishlist">
          <Heart />
          <span>Wishlist</span>
        </a>
        <a href="/cart">
          <ShoppingCart />
          <span>Cart {cartCount ? `(${cartCount})` : ""}</span>
        </a>
        <a
          href={
            viewer
              ? viewer.role === "CUSTOMER"
                ? "/account"
                : viewer.role === "STAFF"
                  ? "/staff"
                  : "/admin"
              : "/login"
          }
        >
          <CircleUserRound />
          <span>{viewer ? viewer.firstName : "Account"}</span>
        </a>
      </nav>

      <button
        className="approved-services"
        popoverTarget="healthfield-services"
        aria-label="Open Healthfield services"
      >
        <Image src="/healthfield-icon.png" alt="" width={54} height={46} />
      </button>
      <div
        className="approved-services-overlay"
        id="healthfield-services"
        popover="auto"
      >
        <section aria-label="Healthfield services">
          <header>
            <strong>Healthfield Services</strong>
          </header>
          <a
            className="need-help-call"
            href={
              contact.phone
                ? `tel:${contact.phone.replace(/\D/g, "")}`
                : "/contact"
            }
          >
            <Phone />
            <span>
              <strong>Need Help?</strong>
              <small>
                {contact.phone
                  ? `Call Pharmacy · ${contact.phone}`
                  : "Contact the pharmacy"}
              </small>
            </span>
          </a>
          <a href="/prescriptions/upload">
            <Upload /> Upload Prescription
          </a>
          <a
            href={
              contact.whatsapp
                ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`
                : "/login"
            }
          >
            <HeartPulse /> Talk to a Pharmacist
          </a>
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/\D/g, "")}`}>
              <Phone /> Call — Need help?
            </a>
          )}
          {contact.whatsapp && (
            <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}>
              <MessageCircle /> WhatsApp us
            </a>
          )}
          <a href="/account#orders">
            <Package /> Track an Order
          </a>
          <a href={viewer ? "/account" : "/login"}>
            <CircleUserRound /> My Account
          </a>
        </section>
      </div>
      <footer className="store-footer">
        <div className="footer-about">
          {contact.licenceNumber && (
            <strong className="footer-licence-number">
              <span>Pharmacy Licence</span>
              <b>{contact.licenceNumber}</b>
            </strong>
          )}
          <Image
            src="/healthfield-logo-clean.png"
            alt="Healthfield Pharmacy"
            width={190}
            height={68}
          />
          <p>
            Your trusted pharmacy for medicines, skincare, wellness and
            personal-care essentials.
          </p>
          <div className="social-links">
            {contact.facebookUrl && (
              <a
                href={contact.facebookUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
              >
                f
              </a>
            )}
            {contact.instagramUrl && (
              <a
                href={contact.instagramUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
              >
                IG
              </a>
            )}
            {contact.xUrl && (
              <a
                href={contact.xUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="X"
              >
                X
              </a>
            )}
            {contact.tiktokUrl && (
              <a
                href={contact.tiktokUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="TikTok"
              >
                TT
              </a>
            )}
          </div>
        </div>
        <nav>
          <strong>Shop & services</strong>
          <a href="/#products">Shop products</a>
          <a href="/prescriptions/upload">Upload prescription</a>
          <a href="/conditions">Shop by condition</a>
          <a href={viewer ? "/chat" : "/login?next=/chat"}>Chat with us</a>
          <a href="/account#orders">Track an order</a>
        </nav>
        <nav>
          <strong>Help & information</strong>
          <a href="/blog">Blogs & health guide</a>
          <a href="/about">About Healthfield</a>
          <a href="/faq">Frequently asked questions</a>
          <a href="/contact">Contact us</a>
          <a href="/pharmacy/juja">Pharmacy service areas</a>
          <a href="/shipping-policy">Shipping & delivery</a>
          <a href="/returns-policy">Returns & refunds</a>
        </nav>
        <nav>
          <strong>Legal</strong>
          <a href="/terms">Terms & conditions</a>
          <a href="/privacy-policy">Privacy policy</a>
          <span>Secure checkout</span>
          <span>Genuine products</span>
        </nav>
        <div className="footer-contact">
          <strong>Contact</strong>
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/\s/g, "")}`}>
              {contact.phone}
            </a>
          )}
          {contact.whatsapp && (
            <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}>
              WhatsApp {contact.whatsapp}
            </a>
          )}
          {contact.supportEmail && (
            <a href={`mailto:${contact.supportEmail}`}>
              {contact.supportEmail}
            </a>
          )}
          {contact.address && <span>{contact.address}</span>}
          {contact.openingHours && <span>{contact.openingHours}</span>}
          <small>{contact.deliveryMessage}</small>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} Healthfield Pharmacy. All rights
            reserved.
          </span>
          <span>
            Product information does not replace professional medical advice.
          </span>
        </div>
      </footer>
    </div>
  );
}
