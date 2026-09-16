"use client";

import { Check, Heart, Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { defaultVariant, variantDisplayName } from "@/lib/product-variants";
import { PrescriptionAddButton } from "./prescription-add-button";
import { VariantPicker } from "./variant-picker";

export type ProductCardProduct = {
  id: number;
  name: string;
  imageUrl: string | null;
  price: number | string;
  discountPrice: number | string | null;
  prescriptionRequired?: boolean;
  rating?: number | null;
  reviewCount?: number;
  variantLabel?: string | null;
};

/**
 * One product on the grid — and, when it has variants, the chooser for them.
 *
 * The choice is made *on the card*, not in a dialog after the press: swiping the image
 * (or tapping an option) changes which variant the card is showing, price and stock and
 * all, and Add puts exactly what is on screen into the basket. Asking afterwards would
 * either nag on every press or have to remember a choice, and remembering breaks the
 * moment someone wants the blue one and the red one. Swiping to the next option and
 * pressing Add again is the whole interaction.
 */
export function ProductCard({
  product,
  variants,
  groupName,
  optionName = "Option",
  wishlistActive = false,
  cartQuantity = 0,
  cartQuantities,
  returnTo,
  onAddToCart,
  onVariantAdded,
}: {
  product: ProductCardProduct;
  /** Every variant in this product's group, in shop order. Omitted for a plain product. */
  variants?: ProductCardProduct[];
  /** The product's name without any variant label. Defaults to the shown variant's name. */
  groupName?: string;
  optionName?: string;
  wishlistActive?: boolean;
  cartQuantity?: number;
  /** Basket counts by product id, so the button can follow the chosen variant. */
  cartQuantities?: Record<number, number>;
  returnTo: string;
  onAddToCart?: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  /** Told what went in the basket, so the page holding the counts can update them. */
  onVariantAdded?: (productId: number, quantity: number, cart?: Record<number, number>) => void;
}) {
  const options = variants && variants.length > 1 ? variants : null;
  // The caller decides which option the card opens on — the cheapest in stock when
  // browsing, the one that actually matched when searching — so `product` is honoured
  // whenever it is one of the options, and only falls back when it is not.
  const [chosenId, setChosenId] = useState(() =>
    !options || options.some((variant) => variant.id === product.id)
      ? product.id
      : defaultVariant(options).id,
  );
  const shown = options ? options.find((variant) => variant.id === chosenId) ?? options[0] : product;
  const name = groupName ?? product.name;
  const router = useRouter();
  const rail = useRef<HTMLDivElement>(null);
  // Where a press started, so a tap on the picture can open the product while a swipe
  // across it only changes the option. Taking the image out of the link was what made
  // the card swipeable; this puts the tap back without making every swipe a navigation.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  // Adding a product that comes in options asks which one, and how many, rather than
  // guessing from whatever the card happened to be showing.
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pickerError, setPickerError] = useState("");
  // The card's own "that worked" — a green tick for a moment, the same signal the
  // product page gives. Without it the only sign an add landed is a small number
  // changing somewhere, which is easy to miss on a phone.
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (addedTimer.current) clearTimeout(addedTimer.current);
  }, []);

  function showAdded() {
    setJustAdded(true);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(false), 1700);
  }

  async function addChosenVariant(variant: ProductCardProduct, quantity: number) {
    setAdding(true);
    setPickerError("");
    const body = new URLSearchParams({
      productId: String(variant.id),
      action: "add",
      quantity: String(quantity),
      return: returnTo,
    });
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // A prescription medicine cannot simply be dropped in a basket; the server says
        // where to go instead, and that is a page change, not an error to sit on.
        if (data.uploadUrl) return window.location.assign(data.uploadUrl);
        setPickerError(data.error || "This could not be added. Please try again.");
        return;
      }
      setPicking(false);
      showAdded();
      onVariantAdded?.(variant.id, quantity, data.cart);
    } catch {
      setPickerError("Could not reach the server. Please try again.");
    } finally {
      setAdding(false);
    }
  }
  // Swiping the images and tapping an option are the same act, so each has to move the
  // other. Scrolling the rail in response to a tap must not be read back as a swipe.
  const settling = useRef(false);
  const choose = useCallback((id: number) => {
    if (!options) return;
    setChosenId(id);
    const index = options.findIndex((variant) => variant.id === id);
    const element = rail.current;
    if (!element || index < 0) return;
    settling.current = true;
    element.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
    window.setTimeout(() => { settling.current = false; }, 400);
  }, [options]);
  useEffect(() => {
    const element = rail.current;
    if (!element || !options) return;
    const onScroll = () => {
      if (settling.current) return;
      const index = Math.round(element.scrollLeft / Math.max(1, element.clientWidth));
      const variant = options[Math.min(options.length - 1, Math.max(0, index))];
      if (variant) setChosenId((current) => (current === variant.id ? current : variant.id));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [options]);
  const regularPrice = Number(shown.price),
    discountPrice =
      shown.discountPrice === null ? null : Number(shown.discountPrice),
    sellingPrice = discountPrice ?? regularPrice;
  const discount =
    discountPrice !== null && regularPrice > discountPrice
      ? Math.round((1 - discountPrice / regularPrice) * 100)
      : 0;
  // A missing file left an empty frame behind, so a failed load falls back to the
  // same placeholder used when a product has no artwork at all.
  const [failedImages, setFailedImages] = useState<number[]>([]);
  const showImage = Boolean(shown.imageUrl) && !failedImages.includes(shown.id);
  const basketCount = cartQuantities ? cartQuantities[shown.id] ?? 0 : cartQuantity;
  // What the basket, the wishlist and every announcement call this: never "Tote bag"
  // when what is about to be added is the blue one.
  const variantDisplay = variantDisplayName(name, shown.variantLabel);
  // The badge on a card with options counts every option of the product in the basket,
  // not just the one on screen: two reds and a blue is three of this product.
  const groupBasketCount = options && cartQuantities
    ? options.reduce((total, variant) => total + (cartQuantities[variant.id] ?? 0), 0)
    : basketCount;
  return (
    <article className="approved-product">
      {/* A card with a choice keeps the image box outside the link: the strip is there to
          be swiped and tapped, and every one of those gestures would otherwise be a
          navigation. The name below still opens the product. A plain product is
          untouched — image and all — so nothing about the ordinary card changes. */}
      {options && (
        <div className="approved-product-image variant-image-box">
          {discount > 0 && (
            <span className="discount-badge">Save {discount}%</span>
          )}
          <div
            className="variant-image-rail"
            ref={rail}
            onPointerDown={(event) => {
              pressedAt.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              const start = pressedAt.current;
              pressedAt.current = null;
              if (!start) return;
              // A few pixels of travel is a tap with a shaky thumb; more than that was a
              // swipe, and a swipe must never open the page out from under it.
              const moved =
                Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8;
              if (!moved) router.push(`/products/${shown.id}`);
            }}
            onPointerCancel={() => {
              pressedAt.current = null;
            }}
          >
            {options.map((variant) => (
              <span className="variant-image-slide" key={variant.id}>
                {variant.imageUrl && !failedImages.includes(variant.id) ? (
                  <img
                    src={variant.imageUrl}
                    alt={`${name}, ${variant.variantLabel || ""}`.trim()}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedImages((current) => [...current, variant.id])}
                  />
                ) : (
                  <span className="product-image-missing">
                    <Package />
                    <small>Image pending</small>
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="variant-options" role="group" aria-label={`${optionName} for ${name}`}>
            {options.map((variant) => (
              <button
                type="button"
                key={variant.id}
                className={variant.id === shown.id ? "is-chosen" : ""}
                aria-pressed={variant.id === shown.id}
                onClick={() => choose(variant.id)}
              >
                {variant.variantLabel || "Standard"}
              </button>
            ))}
          </div>
        </div>
      )}
      <Link
        prefetch={false}
        className={`approved-product-main${options ? " has-variants" : ""}`}
        href={`/products/${shown.id}`}
        aria-label={`View ${name}`}
      >
        {!options && (
          <div className="approved-product-image">
            {discount > 0 && (
              <span className="discount-badge">Save {discount}%</span>
            )}
            {
showImage ? (
              <img
                src={shown.imageUrl!}
                alt={name}
                loading="lazy"
                decoding="async"
                onError={() => setFailedImages((current) => [...current, shown.id])}
              />
            ) : (
              <div className="product-image-missing">
                <Package />
                <small>Image pending</small>
              </div>
            )}
          </div>
        )}
        <div className="approved-product-info">
          <span className="product-card-name">{name}</span>
          {!!product.rating && (
            <div
              className="approved-rating"
              aria-label={`${product.rating.toFixed(1)} from ${product.reviewCount ?? 0} reviews`}
            >
              ★ {product.rating.toFixed(1)}{" "}
              <small>({product.reviewCount ?? 0})</small>
            </div>
          )}
        </div>
      </Link>
      <form
        action="/api/wishlist"
        method="post"
        className="product-wishlist-form"
      >
        <input type="hidden" name="productId" value={shown.id} />
        <input type="hidden" name="return" value={returnTo} />
        <button
          type="submit"
          className={`approved-wishlist ${wishlistActive ? "active" : ""}`}
          aria-label={`Save ${variantDisplay}`}
        >
          <Heart />
        </button>
      </form>
      <div className="product-card-footer">
        <span className="product-card-prices">
          <span className="product-card-price">
            KES {Math.round(sellingPrice).toLocaleString("en-KE")}
          </span>
          {discount > 0 && (
            <del>KES {Math.round(regularPrice).toLocaleString("en-KE")}</del>
          )}
        </span>
        {shown.prescriptionRequired ? (
          <PrescriptionAddButton
            className="approved-cart prescription-cart-trigger"
            ariaLabel={`Prescription required for ${variantDisplay}`}
            items={[{ id: shown.id, name: variantDisplay }]}
          >
            <ShoppingCart />
          </PrescriptionAddButton>
        ) : (
          options ? (
            <button
              type="button"
              className={`approved-cart${justAdded ? " is-added" : ""}`}
              aria-haspopup="dialog"
              aria-label={`Choose ${optionName.toLowerCase()} for ${name} and add to cart`}
              onClick={() => { setPickerError(""); setPicking(true); }}
            >
              {justAdded ? <Check /> : groupBasketCount ? <b>{groupBasketCount}</b> : <ShoppingCart />}
            </button>
          ) : (
            <form
              action="/api/cart"
              method="post"
              onSubmit={onAddToCart && (async (event) => {
                // The handler reads the form and prevents the default synchronously, so
                // awaiting it afterwards is safe; the tick waits for the basket to
                // actually come back rather than firing on the press.
                await onAddToCart(event);
                showAdded();
              })}
            >
              <input type="hidden" name="productId" value={shown.id} />
              <input type="hidden" name="action" value="add" />
              <input type="hidden" name="return" value={returnTo} />
              <button
                type="submit"
                className={`approved-cart${justAdded ? " is-added" : ""}`}
                aria-label={`Add ${variantDisplay} to cart`}
              >
                {justAdded ? <Check /> : basketCount ? <b>{basketCount}</b> : <ShoppingCart />}
              </button>
            </form>
          )
        )}
      </div>
      {options ? (
        <VariantPicker
          productName={name}
          optionName={optionName}
          variants={options}
          open={picking}
          busy={adding}
          error={pickerError}
          onClose={() => setPicking(false)}
          onAdd={addChosenVariant}
        />
      ) : null}
    </article>
  );
}
