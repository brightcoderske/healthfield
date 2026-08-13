"use client";

import { Heart, Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PrescriptionAddButton } from "./prescription-add-button";

export type ProductCardProduct = {
  id: number;
  name: string;
  imageUrl: string | null;
  price: number | string;
  discountPrice: number | string | null;
  prescriptionRequired?: boolean;
  rating?: number | null;
  reviewCount?: number;
};

export function ProductCard({
  product,
  wishlistActive = false,
  cartQuantity = 0,
  returnTo,
  onAddToCart,
}: {
  product: ProductCardProduct;
  wishlistActive?: boolean;
  cartQuantity?: number;
  returnTo: string;
  onAddToCart?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const regularPrice = Number(product.price),
    discountPrice =
      product.discountPrice === null ? null : Number(product.discountPrice),
    sellingPrice = discountPrice ?? regularPrice;
  const discount =
    discountPrice !== null && regularPrice > discountPrice
      ? Math.round((1 - discountPrice / regularPrice) * 100)
      : 0;
  // A missing file left an empty frame behind, so a failed load falls back to the
  // same placeholder used when a product has no artwork at all.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(product.imageUrl) && !imageFailed;
  return (
    <article className="approved-product">
      <Link
        prefetch={false}
        className="approved-product-main"
        href={`/products/${product.id}`}
        aria-label={`View ${product.name}`}
      >
        <div className="approved-product-image">
          {discount > 0 && (
            <span className="discount-badge">Save {discount}%</span>
          )}
          {showImage ? (
            <img
              src={product.imageUrl!}
              alt={product.name}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="product-image-missing">
              <Package />
              <small>Image pending</small>
            </div>
          )}
        </div>
        <div className="approved-product-info">
          <span className="product-card-name">{product.name}</span>
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
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="return" value={returnTo} />
        <button
          type="submit"
          className={`approved-wishlist ${wishlistActive ? "active" : ""}`}
          aria-label={`Save ${product.name}`}
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
        {product.prescriptionRequired ? (
          <PrescriptionAddButton
            className="approved-cart prescription-cart-trigger"
            ariaLabel={`Prescription required for ${product.name}`}
            items={[{ id: product.id, name: product.name }]}
          >
            <ShoppingCart />
          </PrescriptionAddButton>
        ) : (
          <form action="/api/cart" method="post" onSubmit={onAddToCart}>
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="action" value="add" />
            <input type="hidden" name="return" value={returnTo} />
            <button
              type="submit"
              className="approved-cart"
              aria-label={`Add ${product.name} to cart`}
            >
              {cartQuantity ? <b>{cartQuantity}</b> : <ShoppingCart />}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}
