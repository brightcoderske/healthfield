import { ArrowLeft, Heart, Package, ShoppingCart } from "lucide-react";
import { PrescriptionAddButton } from "@/app/prescription-add-button";
import Link from "next/link";

type Product = {
  id: number;
  name: string;
  price: string;
  discountPrice: string | null;
  imageUrl: string | null;
  prescriptionRequired: boolean;
};

export function WishlistView({ items }: { items: Product[] }) {
  return (
    <main className="wishlist-page">
      <header>
      <Link href="/">
        <ArrowLeft /> Home
      </Link>
        <h1>Wishlist</h1>
      </header>
      {items.length === 0 ? (
        <div className="database-empty">
          <Heart />
          <strong>No saved products</strong>
          <span>Use the heart icon on a product to save it here.</span>
        </div>
      ) : (
        <section>
          {items.map((product) => (
            <article key={product.id}>
              <a href={`/products/${product.id}`}>
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} />
                ) : (
                  <Package />
                )}
                <strong>{product.name}</strong>
                <b>
                  KES{" "}
                  {Number(
                    product.discountPrice ?? product.price,
                  ).toLocaleString()}
                </b>
              </a>
              <div>
                {product.prescriptionRequired ? (
                  <PrescriptionAddButton
                    items={[{ id: product.id, name: product.name }]}
                  >
                    <ShoppingCart /> Add to cart
                  </PrescriptionAddButton>
                ) : (
                  <form action="/api/cart" method="post">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="return" value="/wishlist" />
                    <button type="submit">
                      <ShoppingCart /> Add to cart
                    </button>
                  </form>
                )}
                <form action="/api/wishlist" method="post">
                  <input type="hidden" name="productId" value={product.id} />
                  <input type="hidden" name="return" value="/wishlist" />
                  <button type="submit">Remove</button>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
