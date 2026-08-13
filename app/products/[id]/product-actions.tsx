"use client";

import {
  Check,
  Heart,
  Minus,
  Plus,
  Share2,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CART_UPDATED_EVENT } from "./product-cart-link";
import { PrescriptionAddButton } from "@/app/prescription-add-button";

export function ProductActions({
  productId,
  productName,
  productUrl,
  prescriptionRequired = false,
  initialQuantity = 0,
  initialCartCount = 0,
}: {
  productId: number;
  productName: string;
  productUrl: string;
  prescriptionRequired?: boolean;
  initialQuantity?: number;
  initialCartCount?: number;
}) {
  const [quantity, setQuantity] = useState(() => Math.max(0, initialQuantity));
  const [cartCount, setCartCount] = useState(initialCartCount);
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

  function applyCart(cart: Record<number, number>) {
    const productQuantity = Number(cart[productId]) || 0;
    const nextCount = Object.values(cart).reduce(
      (total, value) => total + Number(value),
      0,
    );
    setQuantity(Math.max(0, productQuantity));
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
    } | null;
    if (!response.ok || !data?.cart)
      throw new Error(data?.error || "Cart could not be updated.");
    applyCart(data.cart);
  }

  async function addToCart(formElement: HTMLFormElement) {
    if (cartState === "saving" || quantitySaving) return;
    if (addedTimer.current) clearTimeout(addedTimer.current);
    setCartState("saving");
    try {
      await sendCart(new FormData(formElement));
      showFeedback("added", 1600);
    } catch {
      showFeedback("error", 2200);
    }
  }

  async function setCartQuantity(nextQuantity: number) {
    if (cartState === "saving" || quantitySaving) return;
    const previousQuantity = quantity;
    const next = Math.max(0, Math.min(99, nextQuantity));
    setQuantity(next);
    setQuantitySaving(true);
    const form = new FormData();
    form.set("productId", String(productId));
    form.set("action", "set");
    form.set("quantity", String(next));
    try {
      await sendCart(form);
    } catch {
      setQuantity(previousQuantity);
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
        <div className="product-cart-controls">
          <div className="quantity-stepper">
            <form
              action="/api/cart"
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                void setCartQuantity(quantity - 1);
              }}
            >
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="action" value="set" />
              <input type="hidden" name="quantity" value={quantity - 1} />
              <input
                type="hidden"
                name="return"
                value={`/products/${productId}`}
              />
              <button
                type="submit"
                disabled={
                  quantity <= 0 || cartState === "saving" || quantitySaving
                }
                aria-label="Decrease this product quantity"
              >
                <Minus />
              </button>
            </form>
            <input
              type="number"
              min="0"
              max="99"
              inputMode="numeric"
              value={quantity}
              readOnly
              aria-label={`${productName} quantity in cart`}
              aria-live="polite"
            />
            <form
              action="/api/cart"
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                void setCartQuantity(quantity + 1);
              }}
            >
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="action" value="set" />
              <input type="hidden" name="quantity" value={quantity + 1} />
              <input
                type="hidden"
                name="return"
                value={`/products/${productId}`}
              />
              <button
                type="submit"
                disabled={
                  quantity >= 99 || cartState === "saving" || quantitySaving
                }
                aria-label="Increase this product quantity"
              >
                <Plus />
              </button>
            </form>
          </div>
          <form
            className="product-add-form"
            action="/api/cart"
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              void addToCart(event.currentTarget);
            }}
          >
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="action" value="add" />
            <input type="hidden" name="quantity" value="1" />
            <input
              type="hidden"
              name="return"
              value={`/products/${productId}`}
            />
            <button
              className={`primary-cart-action ${cartState === "added" ? "is-added" : ""}`}
              type="submit"
              disabled={cartState === "saving" || quantitySaving}
              aria-live="polite"
            >
              {cartState === "added" ? <Check /> : <ShoppingCart />}
              <span>
                {cartState === "saving"
                  ? "Adding…"
                  : cartState === "added"
                    ? "Added to cart"
                    : cartState === "error"
                      ? "Try again"
                      : "Add to cart"}
              </span>
              {quantity > 0 ? (
                <b
                  className="cart-action-badge"
                  aria-label={`${quantity} ${productName} in cart`}
                >
                  {quantity > 99 ? "99+" : quantity}
                </b>
              ) : null}
            </button>
          </form>
        </div>
      )}
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
