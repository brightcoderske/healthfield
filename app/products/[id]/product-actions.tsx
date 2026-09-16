"use client";

import {
  Check,
  Heart,
  Share2,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CART_UPDATED_EVENT } from "./product-cart-link";
import { PrescriptionAddButton } from "@/app/prescription-add-button";
import { QuantityField } from "@/app/quantity-field";
import { announceCartAdded } from "@/app/cart-toast";
import { VariantPicker } from "@/app/variant-picker";
import type { ProductCardProduct } from "@/app/product-card";

/**
 * Adding this product to the basket, from its own page.
 *
 * One clear Add to cart. A product that comes in options asks which one and how many
 * first; a single product goes straight in. Only once something is in the basket does
 * the quantity control appear, and the button stays changed — "In cart", in green, with
 * the way to the basket — rather than flashing and reverting, which read as nothing
 * having happened. Every change to the quantity says so too: the buttons used to alter
 * the basket silently, and a customer on a phone had no way to tell it had worked.
 */
const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

export function ProductActions({
  productId,
  productName,
  productUrl,
  prescriptionRequired = false,
  initialCart = {},
  initialCartCount = 0,
  groupName,
  optionName = "Option",
  variants = [],
  unitPrice,
  regularPrice,
}: {
  productId: number;
  productName: string;
  productUrl: string;
  prescriptionRequired?: boolean;
  /** The basket as it stood when the page was rendered, by product id. */
  initialCart?: Record<number, number>;
  initialCartCount?: number;
  /** The product's name without its option label, for the chooser's heading. */
  groupName?: string;
  optionName?: string;
  /** Every option of this product; empty or a single entry when there is nothing to choose. */
  variants?: ProductCardProduct[];
  /** What one of this product sells for, and its price before any discount. */
  unitPrice?: number;
  regularPrice?: number;
}) {
  const [cart, setCart] = useState<Record<number, number>>(initialCart);
  const [cartCount, setCartCount] = useState(initialCartCount);
  const hasOptions = variants.length > 1;
  const optionIds = hasOptions ? variants.map((variant) => variant.id) : [productId];
  // Which option the quantity control adjusts: the last one added, or this page's own.
  const [activeId, setActiveId] = useState(productId);
  const inBasket = (id: number) => Number(cart[id]) || 0;
  const productTotal = optionIds.reduce((total, id) => total + inBasket(id), 0);
  // If the option being adjusted has been taken back to zero while another option is
  // still in the basket, the control follows the one that is.
  const adjustingId = inBasket(activeId) > 0
    ? activeId
    : optionIds.find((id) => inBasket(id) > 0) ?? activeId;
  const quantity = inBasket(adjustingId);
  const adjusting = hasOptions ? variants.find((variant) => variant.id === adjustingId) : undefined;
  const adjustingLabel = adjusting?.variantLabel || "";
  // The running total follows the quantity, so a customer sees what three of them cost
  // rather than working it out. For a product with options it is the option being adjusted.
  const eachPrice = adjusting ? Number(adjusting.discountPrice ?? adjusting.price) : unitPrice;
  const eachRegular = adjusting ? Number(adjusting.price) : regularPrice;
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [cartState, setCartState] = useState<
    "idle" | "saving" | "added" | "error"
  >("idle");
  const [quantitySaving, setQuantitySaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nativeShare, setNativeShare] = useState(false);
  const shareMenu = useRef<HTMLDivElement>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const encodedUrl = encodeURIComponent(productUrl),
    encodedText = encodeURIComponent(`${productName} — ${productUrl}`);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!shareMenu.current?.contains(event.target as Node))
        setShareOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShareOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  function applyCart(next: Record<number, number>) {
    const nextCount = Object.values(next).reduce(
      (total, value) => total + Number(value),
      0,
    );
    setCart(next);
    setCartCount(nextCount);
    window.dispatchEvent(
      new CustomEvent(CART_UPDATED_EVENT, { detail: { count: nextCount } }),
    );
  }

  function showFeedback(state: "added" | "error", duration: number) {
    setCartState(state);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setCartState("idle"), duration);
  }

  async function sendCart(form: FormData) {
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
    const data = (await response.json().catch(() => null)) as {
      cart?: Record<number, number>;
      error?: string;
      uploadUrl?: string;
    } | null;
    // A prescription medicine is sent to the upload page rather than into the basket.
    if (data?.uploadUrl) {
      window.location.assign(data.uploadUrl);
      throw new Error("A prescription is required.");
    }
    if (!response.ok || !data?.cart)
      throw new Error(data?.error || "Cart could not be updated.");
    applyCart(data.cart);
  }

  function cartForm(id: number, action: "add" | "set", amount: number) {
    const form = new FormData();
    form.set("productId", String(id));
    form.set("action", action);
    form.set("quantity", String(amount));
    return form;
  }

  /** The one Add to cart: asks which option when there is a choice, otherwise adds one. */
  async function pressAdd() {
    if (cartState === "saving" || quantitySaving) return;
    if (hasOptions) {
      setPickerError("");
      setPicking(true);
      return;
    }
    await add(productId, 1);
  }

  async function add(id: number, amount: number) {
    if (addedTimer.current) clearTimeout(addedTimer.current);
    setCartState("saving");
    try {
      await sendCart(cartForm(id, "add", amount));
      setActiveId(id);
      setPicking(false);
      showFeedback("added", 1600);
      announceCartAdded();
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "This could not be added.");
      showFeedback("error", 2200);
    }
  }

  async function setCartQuantity(nextQuantity: number) {
    if (cartState === "saving" || quantitySaving) return;
    const previous = quantity;
    const next = Math.max(0, Math.min(99, nextQuantity));
    if (next === previous) return;
    setQuantitySaving(true);
    try {
      await sendCart(cartForm(adjustingId, "set", next));
      // Said out loud every time: these buttons used to change the basket silently.
      announceCartAdded(
        next === 0 ? "Removed from cart" : next > previous ? "Added to cart" : "Cart updated",
      );
    } catch {
      showFeedback("error", 2200);
    } finally {
      setQuantitySaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(productUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  async function shareMore() {
    try {
      await navigator.share({
        title: productName,
        text: productName,
        url: productUrl,
      });
      setShareOpen(false);
    } catch {}
  }

  return (
    <div className="product-actions compact-product-actions">
      {prescriptionRequired ? (
        <PrescriptionAddButton
          className="primary-cart-action prescription-primary-action"
          ariaLabel={`Prescription required for ${productName}`}
          items={[{ id: productId, name: productName }]}
        >
          <ShoppingCart />
          <span>Add to cart</span>
        </PrescriptionAddButton>
      ) : (
        <div className={`product-cart-controls${productTotal > 0 ? " is-in-cart" : ""}`}>
          {productTotal > 0 ? (
            <>
              {/* Appears only once something is in the basket, and adjusts the option
                  that was added. The number can be typed as well as nudged. */}
              <div className="product-quantity-control">
                {adjustingLabel ? <span className="product-quantity-label">{adjustingLabel}</span> : null}
                <QuantityField
                  className="quantity-stepper quantity-field"
                  value={quantity}
                  min={0}
                  onChange={(next) => void setCartQuantity(next)}
                  disabled={cartState === "saving" || quantitySaving}
                  label={`${adjustingLabel ? `${productName} ${adjustingLabel}` : productName} quantity in cart`}
                />
              </div>
              {/* The button stays changed while the product is in the basket, and becomes
                  the way to it. */}
              <a
                className={`primary-cart-action is-in-cart${cartState === "added" ? " is-added" : ""}`}
                href="/cart"
                aria-live="polite"
                aria-label={`${productTotal} added to cart — view cart`}
                title="View cart"
              >
                <Check />
                {/* The count is in the words, and climbs with the quantity, so there is no
                    separate badge repeating it. */}
                <span>{productTotal > 99 ? "99+" : productTotal} added to cart</span>
              </a>
            </>
          ) : (
            <form
              className="product-add-form"
              action="/api/cart"
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                void pressAdd();
              }}
            >
              {/* Without JavaScript this still adds one, as it always did. */}
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="action" value="add" />
              <input type="hidden" name="quantity" value="1" />
              <input type="hidden" name="return" value={`/products/${productId}`} />
              <button
                className={`primary-cart-action${cartState === "error" ? " is-error" : ""}`}
                type="submit"
                disabled={cartState === "saving" || quantitySaving}
                aria-haspopup={hasOptions ? "dialog" : undefined}
                aria-live="polite"
              >
                <ShoppingCart />
                <span>
                  {cartState === "saving"
                    ? "Adding…"
                    : cartState === "error"
                      ? "Try again"
                      : "Add to cart"}
                </span>
              </button>
            </form>
          )}
        </div>
      )}
      {!prescriptionRequired && productTotal > 0 && quantity > 0 && eachPrice !== undefined && Number.isFinite(eachPrice) ? (
        <p className="product-cart-total" aria-live="polite">
          <span>
            {quantity} × {money(eachPrice)}
            {adjustingLabel ? ` · ${adjustingLabel}` : ""}
          </span>
          <strong>
            {money(eachPrice * quantity)}
            {eachRegular !== undefined && eachRegular > eachPrice ? (
              <del>{money(eachRegular * quantity)}</del>
            ) : null}
          </strong>
        </p>
      ) : null}
      {!prescriptionRequired && hasOptions && productTotal > 0 ? (
        <button
          type="button"
          className="product-add-another"
          aria-haspopup="dialog"
          onClick={() => { setPickerError(""); setPicking(true); }}
        >
          + Add another {optionName.toLowerCase()}
        </button>
      ) : null}
      {hasOptions ? (
        <VariantPicker
          open={picking}
          productName={groupName || productName}
          optionName={optionName}
          variants={variants}
          initialVariantId={productId}
          busy={cartState === "saving"}
          error={pickerError}
          onClose={() => setPicking(false)}
          onAdd={(variant, amount) => void add(variant.id, amount)}
        />
      ) : null}
      <a
        className="icon-product-action view-cart-action"
        href="/cart"
        aria-label={`View cart with ${cartCount} items`}
        title="View cart"
      >
        <ShoppingBag />
        {cartCount > 0 ? (
          <b className="cart-action-badge" aria-hidden="true">
            {cartCount > 99 ? "99+" : cartCount}
          </b>
        ) : null}
      </a>
      <form className="icon-action-form" action="/api/wishlist" method="post">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="return" value={`/products/${productId}`} />
        <button
          className="icon-product-action wishlist-product-action"
          type="submit"
          aria-label="Add to wishlist"
          title="Wishlist"
        >
          <Heart />
        </button>
      </form>
      <div className="product-share-menu" ref={shareMenu}>
        <button
          className="icon-product-action share-product-action"
          type="button"
          onClick={() => {
            setNativeShare(typeof navigator.share === "function");
            setShareOpen((open) => !open);
          }}
          aria-label={`Share ${productName}`}
          aria-expanded={shareOpen}
          title="Share"
        >
          <Share2 />
        </button>
        {shareOpen && (
          <div className="product-share-popover" role="menu">
            <button type="button" onClick={copyLink}>
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a
              href={`https://wa.me/?text=${encodedText}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
              target="_blank"
              rel="noreferrer"
            >
              Facebook
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(productName)}&url=${encodedUrl}`}
              target="_blank"
              rel="noreferrer"
            >
              X
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(productName)}&body=${encodedText}`}
            >
              Email
            </a>
            {nativeShare && (
              <button type="button" onClick={shareMore}>
                More apps
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
