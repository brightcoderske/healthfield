import { Package, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { PrescriptionAddButton } from "@/app/prescription-add-button";

export type PromoProduct = {
  id: number;
  name: string;
  imageUrl: string | null;
  price: string;
  discountPrice: string | null;
  packSize: string | null;
  prescriptionRequired: boolean;
};

export function BlogProductPromo({
  product,
  returnTo,
}: {
  product: PromoProduct;
  returnTo: string;
}) {
  const regular = Number(product.price);
  const selling =
    product.discountPrice === null ? regular : Number(product.discountPrice);
  const saving =
    selling < regular ? Math.round((1 - selling / regular) * 100) : 0;
  return (
    <aside
      className="blog-promo"
      aria-label={`Featured product: ${product.name}`}
    >
      <span className="blog-promo-flag">From our pharmacy</span>
      <div className="blog-promo-body">
        <Link
          prefetch={false}
          className="blog-promo-image"
          href={`/products/${product.id}`}
          aria-label={`View ${product.name}`}
        >
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <Package />
          )}
        </Link>
        <div className="blog-promo-detail">
          <Link prefetch={false} href={`/products/${product.id}`}>
            <strong>{product.name}</strong>
          </Link>
          {product.packSize && <small>{product.packSize}</small>}
          <p className="blog-promo-price">
            <b>KES {Math.round(selling).toLocaleString("en-KE")}</b>
            {saving > 0 && (
              <>
                <del>KES {Math.round(regular).toLocaleString("en-KE")}</del>
                <em>Save {saving}%</em>
              </>
            )}
          </p>
          <div className="blog-promo-actions">
            <Link
              prefetch={false}
              className="blog-promo-view"
              href={`/products/${product.id}`}
            >
              View product
            </Link>
            {product.prescriptionRequired ? (
              <PrescriptionAddButton
                items={[{ id: product.id, name: product.name }]}
                ariaLabel={`Prescription required for ${product.name}`}
              >
                <ShoppingCart /> Add to cart
              </PrescriptionAddButton>
            ) : (
              <form action="/api/cart" method="post">
                <input type="hidden" name="productId" value={product.id} />
                <input type="hidden" name="action" value="add" />
                <input type="hidden" name="return" value={returnTo} />
                <button
                  type="submit"
                  aria-label={`Add ${product.name} to cart`}
                >
                  <ShoppingCart /> Add to cart
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
