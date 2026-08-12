"use client";

import {
  Activity,
  CircleUserRound,
  HeartPulse,
  Menu,
  Package,
  Pill,
  Search,
  ShoppingCart,
  Sparkles,
  Stethoscope,
  Thermometer,
  Truck,
  ShieldCheck,
  Phone,
  Upload,
  Heart,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  ArrowUp,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ProductCard } from "./product-card";
import { CatalogueInterruption, type Guide, type OfferTeaser } from "./catalogue-interruption";
import { planBreaks } from "@/lib/catalogue-breaks";

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
type CatalogCategory = { id: number; name: string; slug: string; featuredOnStorefront?: boolean };
type HealthCondition = { id: number; name: string; slug: string };

// The storefront shows a fixed six-category shortlist chosen by an administrator
// (topped up with the remaining categories so the list is never short). Everything
// else lives behind the header "Shop by category" menu.
const CATEGORY_PREVIEW = 6;
const CONDITION_PREVIEW = 5;
// How many products the landing grid renders at a time. The full catalogue stays
// reachable through search, category pages and the sitemap; this only keeps the
// first paint light.
const PRODUCT_PAGE_SIZE = 50;

type HeaderMenu = "category" | "condition";

// The header menus normally open on hover. They are desktop-only, so a caller that
// cannot reach them (narrow viewport) is told to fall back to a full page instead.
function headerMenuReachable(label: HeaderMenu) {
  return Boolean(document.querySelector<HTMLElement>(`[data-nav-menu="${label}"]`)?.offsetParent);
}

const categoryPresentation = [
  { icon: Pill, color: "green" },
  { icon: Sparkles, color: "purple" },
  { icon: Sparkles, color: "pink" },
  { icon: Package, color: "blue" },
  { icon: HeartPulse, color: "pink" },
  { icon: Package, color: "green" },
];

const conditionPresentation = [
  { icon: HeartPulse, color: "pink" },
  { icon: Stethoscope, color: "blue" },
  { icon: Activity, color: "purple" },
  { icon: Thermometer, color: "green" },
  { icon: ShieldCheck, color: "blue" },
];

function SocialIcon({ brand }: { brand: "facebook" | "instagram" | "tiktok" | "whatsapp" }) {
  if (brand === "facebook") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" /></svg>;
  if (brand === "instagram") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" /></svg>;
  if (brand === "tiktok") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3c.6 2.4 2 3.8 4.5 4.1v3.1c-1.7 0-3.2-.5-4.5-1.5v6.1a5.3 5.3 0 1 1-4.6-5.2v3.2a2.2 2.2 0 1 0 1.5 2.1V3H15Z" /></svg>;
  return <svg viewBox="0 0 448 512" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zM223.9 438c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 358.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.9-186.6 184.9zm101.9-138.6c-5.6-2.8-33.2-16.4-38.3-18.2-5.1-1.9-8.8-2.8-12.5 2.8s-14.4 18.2-17.6 22c-3.2 3.7-6.5 4.2-12.1 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.9-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3s19.9 53.7 22.6 57.4c2.8 3.7 39.1 59.7 94.8 83.8 13.2 5.7 23.5 9.1 31.5 11.7 13.2 4.2 25.2 3.6 34.7 2.2 10.6-1.6 33.2-13.6 37.9-26.7 4.6-13.1 4.6-24.3 3.2-26.7-1.3-2.5-5.1-3.9-10.6-6.6z" /></svg>;
}

export function Storefront({
  initialProducts,
  initialCategories,
  initialConditions,
  initialCategoryId,
  initialConditionId,
  contact,
  viewer,
  offersOnly,
  initialCart,
  initialWishlist,
  guides = [],
  offers = [],
  layoutSeed = 1,
}: {
  initialProducts: CatalogProduct[];
  initialCategories: CatalogCategory[];
  initialConditions: HealthCondition[];
  initialCategoryId: number | null;
  initialConditionId: number | null;
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
  guides?: Guide[];
  offers?: OfferTeaser[];
  layoutSeed?: number;
}) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<number, number>>(initialCart);
  const [wishlist] = useState<number[]>(initialWishlist);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(initialCategoryId);
  const [selectedCondition, setSelectedCondition] = useState<number | null>(initialConditionId);
  const [conditionQuery, setConditionQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<HeaderMenu | null>(null);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [searchResults, setSearchResults] = useState<{ products: CatalogProduct[]; similar: CatalogProduct[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const activeSearchResults = query.trim().length >= 2 ? searchResults : null;

  const filtered = useMemo(
    () =>
      (query.trim() ? activeSearchResults?.products || [] : initialProducts).filter(
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
      activeSearchResults,
      initialCategories,
      query,
      selectedCategory,
      selectedCondition,
      offersOnly,
    ],
  );
  const similarProducts = activeSearchResults?.similar || [];
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
  const prescriptionCategory = displayedCategories.find((category) => `${category.name} ${category.slug}`.toLowerCase().includes("prescription"));
  // Administrator picks come first; the rest top the list up so the storefront never
  // renders a short row while nobody has chosen any.
  const visibleCategories = [
    ...displayedCategories.filter((category) => category.featuredOnStorefront),
    ...displayedCategories.filter((category) => !category.featuredOnStorefront),
  ].slice(0, CATEGORY_PREVIEW);
  const hiddenCategoryCount = Math.max(0, displayedCategories.length - visibleCategories.length);
  // Which offer and blog cards break up the catalogue scroll, and where. The rules
  // (spacing, relevance, urgency, seeded variation) live in lib/catalogue-breaks.
  const breakPlan = useMemo(() => planBreaks({
    products: filtered.slice(0, visibleCount).map((product) => ({
      id: product.id, name: product.name,
    })),
    offers,
    guides,
    seed: layoutSeed,
    // A shopper mid-search or mid-filter is working towards something specific.
    focused: Boolean(query.trim() || selectedCategory || selectedCondition || offersOnly),
  }), [filtered, visibleCount, offers, guides, layoutSeed, query, selectedCategory, selectedCondition, offersOnly]);
  const breakAt = useMemo(() => new Map(breakPlan.map((entry) => [entry.position, entry.item])), [breakPlan]);

  const visibleConditions = initialConditions.slice(0, CONDITION_PREVIEW);
  const hiddenConditionCount = Math.max(0, initialConditions.length - visibleConditions.length);

  // "View all" jumps to the header menu that already lists everything, rather than
  // stretching the landing page. Narrow viewports have no header menu, so they get
  // the standalone page instead.
  function revealHeaderMenu(label: HeaderMenu, fallbackUrl: string) {
    if (!headerMenuReachable(label)) return window.location.assign(fallbackUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setOpenMenu(label);
  }
  useEffect(() => {
    if (!openMenu) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.type === "pointerdown" && target?.closest(`[data-nav-menu="${openMenu}"]`)) return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); };
  }, [openMenu]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/catalogue/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await response.json().catch(() => null) as { products?: CatalogProduct[]; similar?: CatalogProduct[] } | null;
        if (!response.ok || !data) throw new Error("Search failed");
        setSearchResults({ products: Array.isArray(data.products) ? data.products : [], similar: Array.isArray(data.similar) ? data.similar : [] });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSearchResults({ products: [], similar: [] });
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    const updateBackToTop = () => setShowBackToTop(window.scrollY > window.innerHeight * 0.6);
    updateBackToTop();
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    return () => window.removeEventListener("scroll", updateBackToTop);
  }, []);
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(
      ".desktop-hero-row aside button",
    );
    const showAll = () => {
      setSelectedCategory(null);
      setVisibleCount(PRODUCT_PAGE_SIZE);
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
          <Link
            prefetch={false}
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
          </Link>
          {viewer?.role === "CUSTOMER" && (
            <a href="/account#orders">
              <Package /> My orders
            </a>
          )}
          {viewer && (
            <form className="desktop-logout" action="/api/auth/logout" method="post">
              <button type="submit">Log out</button>
            </form>
          )}
          <Link prefetch={false} href="/wishlist">
            <Heart /> Wishlist ({wishlist.length})
          </Link>
          <Link prefetch={false} href="/cart">
            <ShoppingCart /> Cart ({cartCount})
          </Link>
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
              onChange={(event) => { setQuery(event.target.value); setSelectedCategory(null); setSelectedCondition(null); setVisibleCount(PRODUCT_PAGE_SIZE); }}
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
          <a className={!selectedCategory ? "active" : ""} href="/">Home</a>
          <a href="/prescriptions/upload">Upload prescription</a>
          <div className={`desktop-nav-dropdown${openMenu === "category" ? " is-open" : ""}`} data-nav-menu="category">
            <button type="button">Shop by category <ChevronDown/></button>
            <div className="desktop-nav-grid category-nav-grid">
              {displayedCategories.map((category) => <a key={category.id} className={selectedCategory===category.id?"active":""} href={`/?category=${category.slug}#products`}>{category.name}</a>)}
            </div>
          </div>
          <div className={`desktop-nav-dropdown${openMenu === "condition" ? " is-open" : ""}`} data-nav-menu="condition">
            <button type="button">Shop by condition <ChevronDown/></button>
            <div className="desktop-nav-grid condition-nav-grid">
              {initialConditions.map((condition) => <a key={condition.id} className={selectedCondition===condition.id?"active":""} href={`/?condition=${condition.slug}#products`}>{condition.name}</a>)}
              <a href="/conditions">View all conditions</a>
            </div>
          </div>
          {prescriptionCategory&&<a href={`/?category=${prescriptionCategory.slug}#products`}>Prescription Medicines</a>}
          <div className="desktop-nav-dropdown services-nav-dropdown">
            <button type="button">Our services <ChevronDown/></button>
            <div className="desktop-nav-grid services-nav-grid">
              <a href="/contact">Pharmacist advice</a><a href="/prescriptions/upload">Prescription fulfilment</a><a href="/chat">Chat with our pharmacy</a><a href="/shipping-policy">Medicine delivery</a><a href="/account#orders">Track an order</a><a href="/conditions">Shop by health need</a>
            </div>
          </div>
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
              onChange={(event) => { setQuery(event.target.value); setSelectedCategory(null); setSelectedCondition(null); setVisibleCount(PRODUCT_PAGE_SIZE); }}
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
          <details>
            <summary>
              <span>Shop by category</span>
              <ChevronDown />
            </summary>
            <div>
              <label>
                <Search />
                <input
                  value={categoryQuery}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="Search categories"
                />
              </label>
              {displayedCategories
                .filter((category) =>
                  category.name
                    .toLowerCase()
                    .includes(categoryQuery.toLowerCase()),
                )
                .slice(0, 10)
                .map((category) => (
                  <a
                    key={category.id}
                    href={`/?category=${category.slug}#products`}
                  >
                    {category.name}
                  </a>
                ))}
            </div>
          </details>
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

      <main className={`approved-content ${query.trim() ? "search-results-active" : ""}`}>
        {!query.trim() && <div className="desktop-hero-row">
          <aside>
            <h2>
              <Menu /> Shop by Category
            </h2>
            {visibleCategories.map(({ name, icon: Icon, id }) => (
              <a
                href={`#category-${id}`}
                key={id}
                onClick={(event) => {
                  event.preventDefault();
                  setSelectedCategory(id);
                  setVisibleCount(PRODUCT_PAGE_SIZE);
                  document
                    .getElementById("products")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Icon />
                {name}
                <span>›</span>
              </a>
            ))}
            {hiddenCategoryCount > 0 && (
              <button type="button" onClick={() => revealHeaderMenu("category", "/#products")}>
                View All Categories →
              </button>
            )}
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
        </div>}
        {query.trim() && <aside className="desktop-search-categories">
          <h2><Menu /> Shop by Category</h2>
          {/* Capped to the same shortlist as the hero list so the panel keeps a fixed
              height instead of growing with every new category. */}
          {visibleCategories.map(({ name, icon: Icon, id }) => (
            <button type="button" className={selectedCategory===id?"active":""} onClick={()=>{setSelectedCategory(selectedCategory===id?null:id);setVisibleCount(PRODUCT_PAGE_SIZE)}} key={id}>
              <Icon />
              {name}
              <span>›</span>
            </button>
          ))}
          <button type="button" onClick={()=>{setSelectedCategory(null);setSelectedCondition(null);setQuery("");setVisibleCount(PRODUCT_PAGE_SIZE)}}>View All Categories →</button>
        </aside>}
        <label className="approved-search">
          <Search />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedCategory(null);
              setSelectedCondition(null);
              setVisibleCount(PRODUCT_PAGE_SIZE);
            }}
            placeholder="Search products, categories..."
            aria-label="Search products and categories"
          />
        </label>

        {!query.trim() && <section className="approved-section" id="conditions">
          <div className="approved-title">
            <h1>Shop by Condition</h1>
            <button className="title-action" type="button" aria-label="View all conditions" onClick={() => revealHeaderMenu("condition", "/conditions")}>
              <span className="title-action-label">View all</span>
              <ChevronRight />
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
            {visibleConditions.map((condition, index) => {
              const { icon: Icon, color } = conditionPresentation[index % conditionPresentation.length];
              return (
                <button
                  key={condition.id}
                  id={`condition-${condition.id}`}
                  onClick={() => {
                    setSelectedCondition(condition.id);
                    setSelectedCategory(null);
                    setVisibleCount(PRODUCT_PAGE_SIZE);
                    document
                      .getElementById("products")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  <span className={color}>
                    <Icon />
                  </span>
                  <small>{condition.name}</small>
                </button>
              );
            })}
          </div>
        </section>}

        <section className="approved-section" id="products">
          <div className="approved-title">
            <div>
              <h2>Shop Health &amp; Wellness</h2>
              <small>{searching ? "Searching the catalogue…" : "Search by product, brand or health need"}</small>
            </div>
          </div>
          <div
            className={`approved-products ${selectedCategory || selectedCondition || query || offersOnly ? "catalogue-expanded" : ""}`}
          >
            {filtered.slice(0, visibleCount).map((product, index) => {
              const slot = breakAt.get(index);
              return <Fragment key={product.id}>
                {slot && <CatalogueInterruption item={slot} />}
                <ProductCard product={product} wishlistActive={wishlist.includes(product.id)} cartQuantity={cart[product.id]} returnTo="/#products" onAddToCart={addToCart} />
              </Fragment>;
            })}
          </div>
          {visibleCount < filtered.length && (
            <button
              className="catalogue-show-more"
              type="button"
              onClick={() => setVisibleCount((count) => count + PRODUCT_PAGE_SIZE)}
            >
              Show more products
            </button>
          )}
          {(selectedCategory || selectedCondition || query || offersOnly) &&
            filtered.length === 0 && (
              <div className="catalogue-empty"><Package /><strong>No matching products</strong><span>Try another category or search term.</span></div>
            )}
          {query.trim() && similarProducts.length > 0 && <section className="search-suggestions"><header><h3>{filtered.length ? "Mostly shopped with" : "Similar products you may need"}</h3><span>Available alternatives from our catalogue</span></header><div className="approved-products catalogue-expanded">{similarProducts.map((product) => <ProductCard key={product.id} product={product} wishlistActive={wishlist.includes(product.id)} cartQuantity={cart[product.id]} returnTo="/#products" onAddToCart={addToCart} />)}</div></section>}
        </section>
      </main>

      <nav className="approved-nav">
        <a className="active" href="/">
          <HeartPulse />
          <span>Home</span>
        </a>
        <Link
          prefetch={false}
          href={
            viewer?.role === "CUSTOMER"
              ? "/account#orders"
              : "/login?next=/account#orders"
          }
        >
          <Package />
          <span>Orders</span>
        </Link>
        <Link prefetch={false} href="/wishlist">
          <Heart />
          <span>Wishlist</span>
        </Link>
        <Link prefetch={false} href="/cart">
          <ShoppingCart />
          <span>Cart {cartCount ? `(${cartCount})` : ""}</span>
        </Link>
        <Link
          prefetch={false}
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
        </Link>
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
                <SocialIcon brand="facebook" />
              </a>
            )}
            {contact.instagramUrl && (
              <a
                href={contact.instagramUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
              >
                <SocialIcon brand="instagram" />
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
                <SocialIcon brand="tiktok" />
              </a>
            )}
            {contact.whatsapp && (
              <a href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                <SocialIcon brand="whatsapp" />
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
      <button className={`back-to-top${showBackToTop ? " visible" : ""}`} type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top" tabIndex={showBackToTop ? 0 : -1}>
        <ArrowUp />
      </button>
    </div>
  );
}
