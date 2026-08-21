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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ConsultBanner } from "./consult-banner";
import { HeroRotator } from "./hero-rotator";
import { PrescriptionHero } from "./prescription-hero";
import { PrescriptionQuickActions } from "./prescription-quick-actions";
import { ProductCard } from "./product-card";
import {
  CatalogueInterruption,
  type Guide,
  type OfferTeaser,
  type Promotion,
} from "./catalogue-interruption";
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
  prescriptionRequired: boolean;
};
type CatalogCategory = {
  id: number;
  name: string;
  slug: string;
  // Null for a main category; the main category's id for a subcategory. The tree is
  // two deep, so a category is either a heading or one of the things under it.
  parentId?: number | null;
  featuredOnStorefront?: boolean;
};
type HealthCondition = { id: number; name: string; slug: string };
type SearchPayload = { products: CatalogProduct[]; similar: CatalogProduct[]; capped?: boolean };

const searchCache = new Map<string, SearchPayload>();

function searchWords(value: string) {
  return value.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function productMatches(
  product: CatalogProduct,
  words: string[],
  categories: CatalogCategory[],
) {
  if (!words.length) return true;
  const haystack =
    `${product.name} ${product.brand || ""} ${product.shortDescription || ""} ${product.description || ""} ${categories.find((category) => category.id === product.categoryId)?.name || ""}`
      .replace(/<[^>]*>/g, " ")
      .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function mergeProducts(primary: CatalogProduct[], secondary: CatalogProduct[]) {
  const seen = new Set<number>();
  return [...primary, ...secondary].filter(
    (product) => !seen.has(product.id) && Boolean(seen.add(product.id)),
  );
}

// The category rail is capped to the height of the hero beside it and scrolls inside
// that, so the list no longer has to be cut to six to stop it stretching the page.
// Administrator picks still lead it; the rest follow rather than being dropped.
const CONDITION_PREVIEW = 5;
// How many products the landing grid renders at a time. The full catalogue stays
// reachable through search, category pages and the sitemap; this only keeps the
// first paint light.
const PRODUCT_PAGE_SIZE = 50;

type HeaderMenu = "category" | "condition";

// The header menus normally open on hover. They are desktop-only, so a caller that
// cannot reach them (narrow viewport) is told to fall back to a full page instead.
function headerMenuReachable(label: HeaderMenu) {
  return Boolean(
    document.querySelector<HTMLElement>(`[data-nav-menu="${label}"]`)
      ?.offsetParent,
  );
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

function SocialIcon({
  brand,
}: {
  brand: "facebook" | "instagram" | "tiktok" | "whatsapp";
}) {
  if (brand === "facebook")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
      </svg>
    );
  if (brand === "instagram")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" />
      </svg>
    );
  if (brand === "tiktok")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 3c.6 2.4 2 3.8 4.5 4.1v3.1c-1.7 0-3.2-.5-4.5-1.5v6.1a5.3 5.3 0 1 1-4.6-5.2v3.2a2.2 2.2 0 1 0 1.5 2.1V3H15Z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 448 512" aria-hidden="true">
      <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zM223.9 438c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 358.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.9-186.6 184.9zm101.9-138.6c-5.6-2.8-33.2-16.4-38.3-18.2-5.1-1.9-8.8-2.8-12.5 2.8s-14.4 18.2-17.6 22c-3.2 3.7-6.5 4.2-12.1 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.9-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3s19.9 53.7 22.6 57.4c2.8 3.7 39.1 59.7 94.8 83.8 13.2 5.7 23.5 9.1 31.5 11.7 13.2 4.2 25.2 3.6 34.7 2.2 10.6-1.6 33.2-13.6 37.9-26.7 4.6-13.1 4.6-24.3 3.2-26.7-1.3-2.5-5.1-3.9-10.6-6.6z" />
    </svg>
  );
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
  promotions = [],
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
  promotions?: Promotion[];
  layoutSeed?: number;
}) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<number, number>>(initialCart);
  const [wishlist] = useState<number[]>(initialWishlist);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(
    initialCategoryId,
  );
  const [selectedCondition, setSelectedCondition] = useState<number | null>(
    initialConditionId,
  );
  const [conditionQuery, setConditionQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<HeaderMenu | null>(null);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PAGE_SIZE);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [searchResults, setSearchResults] = useState<
    (SearchPayload & { term: string }) | null
  >(null);
  const searchScrollRequest = useRef(0);
  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const queryWords = useMemo(() => searchWords(query), [query]);
  const localSearchResults = useMemo(
    () =>
      queryWords.length
        ? initialProducts.filter((product) =>
            productMatches(product, queryWords, initialCategories),
          )
        : initialProducts,
    [initialProducts, initialCategories, queryWords],
  );
  const activeSearchResults = useMemo(() => {
    if (normalizedQuery.length < 2) return null;
    if (searchResults?.term === normalizedQuery) return searchResults;
    const cached = searchCache.get(normalizedQuery);
    return cached ? { term: normalizedQuery, ...cached } : null;
  }, [normalizedQuery, searchResults]);
  const searching = normalizedQuery.length >= 2 && !activeSearchResults;
  const searchedProducts = useMemo(
    () =>
      queryWords.length
        ? mergeProducts(localSearchResults, activeSearchResults?.products || [])
        : initialProducts,
    [
      activeSearchResults,
      initialProducts,
      localSearchResults,
      queryWords.length,
    ],
  );

  const orderedCategories = [...initialCategories].sort((left, right) => {
    const isPrescription = (category: CatalogCategory) =>
      `${category.name} ${category.slug}`
        .toLowerCase()
        .includes("prescription");
    return Number(isPrescription(left)) - Number(isPrescription(right));
  });
  const displayedCategories = orderedCategories.map((category, index) => ({
    ...category,
    ...(`${category.name} ${category.slug}`
      .toLowerCase()
      .includes("prescription")
      ? { icon: Upload, color: "green" }
      : categoryPresentation[index % categoryPresentation.length]),
  }));
  const prescriptionCategory = displayedCategories.find((category) =>
    `${category.name} ${category.slug}`.toLowerCase().includes("prescription"),
  );
  // The subcategories filed under each main category. Everything the storefront shows
  // is derived from this rather than stored twice, so a category the shop moves in the
  // admin appears in its new place — with its products — on the next load.
  const subCategories = useMemo(() => {
    const listed = new Set(displayedCategories.map((category) => category.id));
    const map = new Map<number, typeof displayedCategories>();
    for (const category of displayedCategories) {
      // A subcategory whose parent is no longer on the shelf stands on its own rather
      // than disappearing: losing a heading must not take its products with it.
      if (!category.parentId || !listed.has(category.parentId)) continue;
      map.set(category.parentId, [
        ...(map.get(category.parentId) || []),
        category,
      ]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategories]);
  const orphaned = useMemo(() => {
    const listed = new Set(initialCategories.map((category) => category.id));
    return (category: CatalogCategory) =>
      Boolean(category.parentId) && !listed.has(category.parentId as number);
  }, [initialCategories]);
  const mainCategories = displayedCategories.filter(
    (category) => !category.parentId || orphaned(category),
  );
  // Administrator picks lead, everything else follows. Subcategories are reached
  // through their parent, so the rail lists main categories only.
  const visibleCategories = [
    ...mainCategories.filter((category) => category.featuredOnStorefront),
    ...mainCategories.filter((category) => !category.featuredOnStorefront),
  ];
  // Choosing a main category means "everything on this shelf", which includes whatever
  // sits in the subcategories under it. Choosing a subcategory stays exact.
  const selectedCategoryIds = useMemo(() => {
    if (!selectedCategory) return null;
    return new Set([
      selectedCategory,
      ...(subCategories.get(selectedCategory) || []).map(
        (category) => category.id,
      ),
    ]);
  }, [selectedCategory, subCategories]);

  // Prescription medicines are kept out of the browsing catalogue but stay findable:
  // someone who knows what they were prescribed can search for it by name, while a
  // casual scroll of the homepage never puts prescription-only medicine in front of
  // someone who has not been prescribed it. Any active filter counts as intent too.
  const browsingOnly = !normalizedQuery && !selectedCategory && !selectedCondition && !offersOnly;
  const filtered = useMemo(
    () =>
      searchedProducts.filter(
        (product) =>
          productMatches(product, queryWords, initialCategories) &&
          (!browsingOnly || !product.prescriptionRequired) &&
          (!selectedCategoryIds ||
            selectedCategoryIds.has(product.categoryId)) &&
          (!selectedCondition ||
            product.conditionIds.includes(selectedCondition)) &&
          (!offersOnly || product.discountPrice !== null),
      ),
    [
      searchedProducts,
      initialCategories,
      queryWords,
      browsingOnly,
      selectedCategoryIds,
      selectedCondition,
      offersOnly,
    ],
  );
  const similarProducts = useMemo(() => {
    const exactIds = new Set(searchedProducts.map((product) => product.id));
    return (activeSearchResults?.similar || []).filter(
      (product) => !exactIds.has(product.id),
    );
  }, [activeSearchResults, searchedProducts]);
  // Which offer and blog cards break up the catalogue scroll, and where. The rules
  // (spacing, relevance, urgency, seeded variation) live in lib/catalogue-breaks.
  const breakPlan = useMemo(
    () =>
      planBreaks({
        products: filtered.slice(0, visibleCount).map((product) => ({
          id: product.id,
          name: product.name,
        })),
        offers,
        guides,
        promotions,
        seed: layoutSeed,
        // A shopper mid-search or mid-filter is working towards something specific.
        focused: Boolean(
          query.trim() || selectedCategory || selectedCondition || offersOnly,
        ),
      }),
    [
      filtered,
      visibleCount,
      offers,
      guides,
      promotions,
      layoutSeed,
      query,
      selectedCategory,
      selectedCondition,
      offersOnly,
    ],
  );
  const breakAt = useMemo(
    () => new Map(breakPlan.map((entry) => [entry.position, entry.item])),
    [breakPlan],
  );

  const visibleConditions = initialConditions.slice(0, CONDITION_PREVIEW);
  // "View all" jumps to the header menu that already lists everything, rather than
  // stretching the landing page. Narrow viewports have no header menu, so they get
  // the standalone page instead.
  function revealHeaderMenu(label: HeaderMenu, fallbackUrl: string) {
    if (!headerMenuReachable(label)) return window.location.assign(fallbackUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setOpenMenu(label);
  }
  // Whether the shopper is working towards something rather than browsing. The landing
  // hero steps aside for it and the category list becomes a filter panel beside the
  // products, which is where someone narrowing down expects to find it.
  const filtering = Boolean(
    query.trim() || selectedCategory || selectedCondition,
  );

  /**
   * Closes the phone menu.
   *
   * Choosing something in the sheet is choosing what to look at, and the sheet covers
   * exactly that. Hiding a popover that is not open throws, hence the check — the same
   * handlers run behind the desktop menus, where this sheet is never showing.
   */
  function closeMobileMenu() {
    const sheet = document.getElementById("mobile-shop-menu") as
      | (HTMLElement & { hidePopover?: () => void })
      | null;
    if (sheet?.matches(":popover-open")) sheet.hidePopover?.();
  }
  function showCategory(categoryId: number) {
    setSelectedCategory(categoryId);
    setSelectedCondition(null);
    setQuery("");
    setVisibleCount(PRODUCT_PAGE_SIZE);
    setOpenMenu(null);
    closeMobileMenu();
    revealFilteredProducts();
  }
  function showCondition(conditionId: number) {
    setSelectedCondition(conditionId);
    setSelectedCategory(null);
    setQuery("");
    setVisibleCount(PRODUCT_PAGE_SIZE);
    setOpenMenu(null);
    closeMobileMenu();
    revealFilteredProducts();
  }
  /**
   * Where the catalogue wants to sit: clear of whatever headers are stuck to the top.
   * Returns null before it exists, and the current position of its heading so callers
   * can decide whether moving the page is worth it at all.
   */
  function cataloguePosition() {
    const section = document.getElementById("products");
    const target = section?.querySelector<HTMLElement>(".approved-title") || section;
    if (!target) return null;
    const stickyBottom = Array.from(
      document.querySelectorAll<HTMLElement>(".desktop-store, .approved-topbar, .rx-search-row"),
    ).reduce((bottom, header) => {
      const bounds = header.getBoundingClientRect();
      return bounds.height > 0 ? Math.max(bottom, bounds.bottom) : bottom;
    }, 0);
    const top = target.getBoundingClientRect().top;
    return { headingTop: top, scrollTo: window.scrollY + top - stickyBottom - 16 };
  }

/**
   * Runs something once the browser has laid the page out again.
   *
   * Two frames, because the hero and the filter panel swap places first and the
   * catalogue has to be measured after that. A frame is not guaranteed to arrive
   * though — a throttled or unpainted tab may never run one — so a short timer backs
   * it up and whichever arrives first wins.
   */
  function afterLayout(run: () => void) {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      run();
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(once));
    window.setTimeout(once, 120);
  }

  /** Moves the page so the catalogue sits below the headers, if it is not there already. */
  function placeCatalogue(behavior: ScrollBehavior) {
    const position = cataloguePosition();
    if (!position) return;
    if (Math.abs(window.scrollY - position.scrollTo) > 1) {
      window.scrollTo({ top: Math.max(0, position.scrollTo), behavior });
    }
  }

  /**
   * Brings the catalogue into view after a filter is chosen — but only when it is not
   * already in view.
   *
   * On a wide screen the products land beside the filter panel, on screen already, and
   * scrolling then would carry them away from where the eye is rather than towards it.
   * On a phone the menu closes onto a page that could be anywhere, so the scroll still
   * has work to do. Deliberately not routed through the search scroll below: that one
   * carries a cancellation token which clearing a search bumps, and a filter reveal
   * must not be cancelled by it.
   */
  function revealFilteredProducts() {
    const settle = () => {
      const position = cataloguePosition();
      if (!position) return;
      const alreadyShowing =
        position.headingTop >= 0 &&
        position.headingTop < window.innerHeight * 0.6;
      if (alreadyShowing) return;
      placeCatalogue("smooth");
      // `scroll-behavior: smooth` on the root means a smooth request can be interrupted
      // by the layout still settling; this lands it exactly, without animating twice.
      window.setTimeout(() => placeCatalogue("instant"), 420);
    };
    afterLayout(settle);
  }

  function scheduleSearchResultsScroll(behavior: ScrollBehavior = "smooth") {
    const request = ++searchScrollRequest.current;
    const placeResultsBelowHeader = (nextBehavior: ScrollBehavior) => {
      if (request !== searchScrollRequest.current) return;
      placeCatalogue(nextBehavior);
    };

    // The hero and filter panels disappear as soon as a search starts, so this measures
    // the catalogue after that layout change rather than before it.
    afterLayout(() => {
      placeResultsBelowHeader(behavior);
      if (behavior === "smooth") {
        window.setTimeout(() => placeResultsBelowHeader("instant"), 420);
      }
    });
  }
  function updateSearchQuery(nextQuery: string) {
    const searchStarting = !query.trim() && Boolean(nextQuery.trim());
    if (!nextQuery.trim()) searchScrollRequest.current += 1;
    setQuery(nextQuery);
    setSelectedCategory(null);
    setSelectedCondition(null);
    setVisibleCount(PRODUCT_PAGE_SIZE);
    if (searchStarting) scheduleSearchResultsScroll();
  }
  function viewSearchResults() {
    if (!query.trim()) return;
    setOpenMenu(null);
    closeMobileMenu();
    scheduleSearchResultsScroll();
  }
  useEffect(() => {
    if (!openMenu) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.type === "pointerdown" &&
        target?.closest(`[data-nav-menu="${openMenu}"]`)
      )
        return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [openMenu]);

  useEffect(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2 || searchCache.has(term)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/catalogue/search?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        const data = (await response.json().catch(() => null)) as {
          products?: CatalogProduct[];
          similar?: CatalogProduct[];
        } | null;
        if (!response.ok || !data) throw new Error("Search failed");
        const result = {
          products: Array.isArray(data.products) ? data.products : [],
          similar: Array.isArray(data.similar) ? data.similar : [],
        };
        searchCache.set(term, result);
        if (searchCache.size > 30)
          searchCache.delete(searchCache.keys().next().value!);
        setSearchResults({ term, ...result });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setSearchResults({ term, products: [], similar: [] });
      }
    }, 80);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    const updateBackToTop = () =>
      setShowBackToTop(window.scrollY > window.innerHeight * 0.6);
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
  async function addToCart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/cart", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      }),
      data = await response.json().catch(() => null);
    if (response.ok && data?.cart) setCart(data.cart);
  }

  return (
    <div className="approved-app">
      <div className="store-utility-strip">
        <span>
          <Truck /> {contact.deliveryMessage || "Delivery across Kenya"}
        </span>
        <a
          href={
            contact.phone
              ? `tel:${contact.phone.replace(/\s/g, "")}`
              : contact.whatsapp
                ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`
                : "/contact"
          }
        >
          <Phone /> {contact.phone || contact.whatsapp || "Call pharmacy"}
        </a>
        {contact.licenceNumber && (
          <span>
            <ShieldCheck /> Pharmacy licence: {contact.licenceNumber}
          </span>
        )}
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
            <form
              className="desktop-logout"
              action="/api/auth/logout"
              method="post"
            >
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
          <Link href="/">
            <Image
              src="/healthfield-logo-clean.png"
              alt="Healthfield Pharmacy"
              width={250}
              height={90}
              priority
            />
          </Link>
          <label>
            <input
              value={query}
              onChange={(event) => updateSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  viewSearchResults();
                }
              }}
              placeholder="Search for medicines, health & wellness products..."
            />
            <button
              type="button"
              onClick={viewSearchResults}
              aria-label="View search results"
            >
              <Search />
            </button>
          </label>
          <ConsultBanner />
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
          <Link className={!selectedCategory ? "active" : ""} href="/">
            Home
          </Link>
          <a href="/prescriptions/upload">Upload prescription</a>
          <a href="/prescriptions/consult">Get a prescription</a>
          <div
            className={`desktop-nav-dropdown${openMenu === "category" ? " is-open" : ""}`}
            data-nav-menu="category"
          >
            <button type="button">
              Shop by category <ChevronDown />
            </button>
            <div className="desktop-nav-grid category-nav-grid">
              {mainCategories.map((category) => (
                <div className="category-nav-column" key={category.id}>
                  <a
                    className={selectedCategory === category.id ? "active" : ""}
                    href="#products"
                    onClick={(event) => {
                      event.preventDefault();
                      showCategory(category.id);
                    }}
                  >
                    {category.name}
                  </a>
                  {(subCategories.get(category.id) || []).length > 0 && (
                    <div className="category-nav-children">
                      {(subCategories.get(category.id) || []).map((child) => (
                        <a
                          key={child.id}
                          className={
                            selectedCategory === child.id ? "active" : ""
                          }
                          href="#products"
                          onClick={(event) => {
                            event.preventDefault();
                            showCategory(child.id);
                          }}
                        >
                          {child.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div
            className={`desktop-nav-dropdown${openMenu === "condition" ? " is-open" : ""}`}
            data-nav-menu="condition"
          >
            <button type="button">
              Shop by condition <ChevronDown />
            </button>
            <div className="desktop-nav-grid condition-nav-grid">
              {initialConditions.map((condition) => (
                <a
                  key={condition.id}
                  className={selectedCondition === condition.id ? "active" : ""}
                  href="#products"
                  onClick={(event) => {
                    event.preventDefault();
                    showCondition(condition.id);
                  }}
                >
                  {condition.name}
                </a>
              ))}
              <a href="/conditions">View all conditions</a>
            </div>
          </div>
          {prescriptionCategory && (
            <a
              href="#products"
              onClick={(event) => {
                event.preventDefault();
                showCategory(prescriptionCategory.id);
              }}
            >
              Prescription Medicines
            </a>
          )}
          <div className="desktop-nav-dropdown services-nav-dropdown">
            <button type="button">
              Our services <ChevronDown />
            </button>
            <div className="desktop-nav-grid services-nav-grid">
              <a href="/contact">Pharmacist advice</a>
              <a href="/prescriptions/upload">Prescription fulfilment</a>
              <a href="/chat">Chat with our pharmacy</a>
              <a href="/shipping-policy">Medicine delivery</a>
              <a href="/account#orders">Track an order</a>
              <a href="/conditions">Shop by health need</a>
            </div>
          </div>
          <Link href="/offers">Offers</Link>
          <Link href="/blog">Blogs</Link>
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
              onChange={(event) => updateSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  viewSearchResults();
                }
              }}
              placeholder="Search products"
            />
          </label>
          <ConsultBanner />
          <Link href="/">Home</Link>
          <Link href="/prescriptions/consult">Get a prescription</Link>
          <Link href="/prescriptions/upload">Upload prescription</Link>
          <Link href="/blog">Blogs &amp; health guide</Link>
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
                    href="#products"
                    onClick={(event) => {
                      event.preventDefault();
                      showCondition(condition.id);
                    }}
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
              {/* Searching flattens the tree — when someone types a name they want the
                  category, not a lesson in where it is filed. Browsing keeps the
                  headings so the shelf still reads as a shelf. */}
              {categoryQuery.trim()
                ? displayedCategories
                    .filter((category) =>
                      category.name
                        .toLowerCase()
                        .includes(categoryQuery.toLowerCase()),
                    )
                    .slice(0, 12)
                    .map((category) => (
                      <a
                        key={category.id}
                        className={category.parentId ? "is-subcategory" : ""}
                        href="#products"
                        onClick={(event) => {
                          event.preventDefault();
                          showCategory(category.id);
                        }}
                      >
                        {category.name}
                      </a>
                    ))
                : mainCategories.map((category) => (
                    <div className="mobile-category-group" key={category.id}>
                      <a
                        href="#products"
                        onClick={(event) => {
                          event.preventDefault();
                          showCategory(category.id);
                        }}
                      >
                        {category.name}
                      </a>
                      {(subCategories.get(category.id) || []).map((child) => (
                        <a
                          key={child.id}
                          className="is-subcategory"
                          href="#products"
                          onClick={(event) => {
                            event.preventDefault();
                            showCategory(child.id);
                          }}
                        >
                          {child.name}
                        </a>
                      ))}
                    </div>
                  ))}
            </div>
          </details>
          <Link href="/offers">Offers</Link>
          <Link href="/offers">Campaign offers</Link>
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
        <Link className="mobile-logo" href="/">
          <Image
            src="/healthfield-logo-clean.png"
            alt="Healthfield Pharmacy"
            width={215}
            height={84}
            priority
          />
        </Link>
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

      <main
        // Named for the case it was written for; it now covers any active filter.
        className={`approved-content ${filtering ? "search-results-active" : ""}`}
      >
        {!filtering && (
          <div className="desktop-hero-row">
            <aside>
              <h2>
                <Menu /> Shop by Category
              </h2>
              {visibleCategories.map(({ name, icon: Icon, id }) => {
                const children = subCategories.get(id) || [];
                return (
                  <a
                    href={`#category-${id}`}
                    key={id}
                    className={selectedCategory === id ? "active" : ""}
                    onClick={(event) => {
                      event.preventDefault();
                      showCategory(id);
                    }}
                  >
                    <Icon />
                    {name}
                    {/* Says there is more inside without opening anything: the list of
                        subcategories belongs in the filter panel, one click away. */}
                    {children.length > 0 ? (
                      <span className="rail-count">{children.length}</span>
                    ) : (
                      <span>›</span>
                    )}
                  </a>
                );
              })}
              <button
                type="button"
                onClick={() => revealHeaderMenu("category", "/#products")}
              >
                Browse every category →
              </button>
            </aside>
            <HeroRotator>
            <section className="hero-slide">
              <div>
                <h1>
                  Your Health,
                  <br />
                  <em>Our Priority</em>
                </h1>
                <p className="desktop-hero-description">
                  Quality medicine and health products delivered to your door.
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
            <PrescriptionHero />
            </HeroRotator>
          </div>
        )}
        {filtering && (
          <aside className="desktop-search-categories">
            <h2>
              <Menu /> Shop by Category
            </h2>
            {/* An accordion, not a set of pop-outs: choosing a category shows everything
              in it and drops its subcategories open underneath, and whatever was open
              before closes. Only one branch is ever open, so the panel cannot grow
              without bound however many categories the shop keeps. */}
            {visibleCategories.map(({ name, icon: Icon, id }) => {
              const children = subCategories.get(id) || [];
              const open =
                selectedCategory === id ||
                children.some((child) => child.id === selectedCategory);
              return (
                <div
                  className={open ? "search-category is-open" : "search-category"}
                  key={id}
                >
                  <button
                    type="button"
                    className={selectedCategory === id ? "active" : ""}
                    aria-expanded={children.length ? open : undefined}
                    onClick={() => {
                      setSelectedCategory(selectedCategory === id ? null : id);
                      setVisibleCount(PRODUCT_PAGE_SIZE);
                    }}
                  >
                    <Icon />
                    {name}
                    <span className={children.length ? "rail-caret" : undefined}>
                      ›
                    </span>
                  </button>
                  {open && children.length > 0 && (
                    <div className="search-subcategories">
                      {children.map((child) => (
                        <button
                          type="button"
                          key={child.id}
                          className={
                            selectedCategory === child.id ? "active" : ""
                          }
                          onClick={() => {
                            // Choosing the open subcategory again widens back out to the
                            // whole shelf rather than dropping the filter altogether.
                            setSelectedCategory(
                              selectedCategory === child.id ? id : child.id,
                            );
                            setVisibleCount(PRODUCT_PAGE_SIZE);
                          }}
                        >
                          {child.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(null);
                setSelectedCondition(null);
                setQuery("");
                setVisibleCount(PRODUCT_PAGE_SIZE);
              }}
            >
              Clear filters →
            </button>
          </aside>
        )}
        <div className="rx-search-row">
          <label className="approved-search">
            <Search />
            <input
              value={query}
              onChange={(event) => updateSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  viewSearchResults();
                }
              }}
              placeholder="Search products, categories..."
              aria-label="Search products and categories"
            />
          </label>
        </div>

        {/* The blocks between the panel and the catalogue are for someone who arrived
            with nothing in mind. Once a filter is on they only separate the filter from
            its results — and, in the two-column layout, they land under both. */}
        {!filtering && (
          <PrescriptionHero className="prescription-hero-mobile" priority />
        )}
        {!filtering && <PrescriptionQuickActions />}

        {!filtering && (
          <section className="approved-section" id="conditions">
            <div className="approved-title">
              <h2>Shop by Condition</h2>
              <button
                className="title-action"
                type="button"
                aria-label="View all conditions"
                onClick={() => revealHeaderMenu("condition", "/conditions")}
              >
                <span className="title-action-label">View all</span>
                <ChevronRight />
              </button>
            </div>
            <div className="approved-categories">
              {visibleConditions.map((condition, index) => {
                const { icon: Icon, color } =
                  conditionPresentation[index % conditionPresentation.length];
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
          </section>
        )}

        <section className="approved-section" id="products">
          <div className="approved-title">
            <div>
              <h2>Shop Health &amp; Wellness</h2>
              <small>
                {searching
                  ? "Searching the catalogue…"
                  : normalizedQuery
                    ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"} across the whole catalogue${activeSearchResults?.capped ? " — refine your words to narrow this down" : ""}`
                    : null}
              </small>
            </div>
          </div>
          <div
            className={`approved-products ${selectedCategory || selectedCondition || query || offersOnly ? "catalogue-expanded" : ""}`}
          >
            {filtered.slice(0, visibleCount).map((product, index) => {
              const slot = breakAt.get(index);
              return (
                <Fragment key={product.id}>
                  {slot && <CatalogueInterruption item={slot} />}
                  <ProductCard
                    product={product}
                    wishlistActive={wishlist.includes(product.id)}
                    cartQuantity={cart[product.id]}
                    returnTo="/#products"
                    onAddToCart={addToCart}
                  />
                </Fragment>
              );
            })}
          </div>
          {visibleCount < filtered.length && (
            <button
              className="catalogue-show-more"
              type="button"
              onClick={() =>
                setVisibleCount((count) => count + PRODUCT_PAGE_SIZE)
              }
            >
              Show more products
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
          {query.trim() && similarProducts.length > 0 && (
            <section className="search-suggestions">
              <header>
                <h3>
                  {filtered.length
                    ? "Mostly shopped with"
                    : "Similar products you may need"}
                </h3>
                <span>Available alternatives from our catalogue</span>
              </header>
              <div className="approved-products catalogue-expanded">
                {similarProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    wishlistActive={wishlist.includes(product.id)}
                    cartQuantity={cart[product.id]}
                    returnTo="/#products"
                    onAddToCart={addToCart}
                  />
                ))}
              </div>
            </section>
          )}
        </section>
      </main>

      <nav className="approved-nav">
        <Link className="active" href="/">
          <HeartPulse />
          <span>Home</span>
        </Link>
        <Link
          prefetch={false}
          href={viewer?.role === "CUSTOMER" ? "/account#orders" : "/login"}
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
        <Image
          src="/healthfield-icon.png"
          alt="Healthfield Pharmacy services"
          width={54}
          height={46}
        />
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
          <ConsultBanner />
          <a href="/prescriptions/consult">
            <Stethoscope /> Get a Prescription
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
                <span className="visually-hidden">Facebook</span>
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
                <span className="visually-hidden">Instagram</span>
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
                <span className="visually-hidden">TikTok</span>
              </a>
            )}
            {contact.whatsapp && (
              <a
                href={`https://wa.me/${contact.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
              >
                <SocialIcon brand="whatsapp" />
                <span className="visually-hidden">WhatsApp</span>
              </a>
            )}
          </div>
        </div>
        <nav>
          <strong>Shop & services</strong>
          <Link href="/#products">Shop products</Link>
          <a href="/prescriptions/upload">Upload prescription</a>
          <a href="/conditions">Shop by condition</a>
          <a href={viewer ? "/chat" : "/login"}>Chat with us</a>
          <a href="/account#orders">Track an order</a>
        </nav>
        <nav>
          <strong>Help & information</strong>
          <Link href="/blog">Blogs & health guide</Link>
          <a href="/about">About Healthfield</a>
          <a href="/faq">Frequently asked questions</a>
          <a href="/contact">Contact us</a>
          <Link href="/pharmacy/juja">Pharmacy service areas</Link>
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
      <button
        className={`back-to-top${showBackToTop ? " visible" : ""}`}
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        tabIndex={showBackToTop ? 0 : -1}
      >
        <ArrowUp />
      </button>
    </div>
  );
}
