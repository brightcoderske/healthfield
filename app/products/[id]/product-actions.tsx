import { Heart, Share2, ShoppingCart } from "lucide-react";

export function ProductActions({ productId, productName, productUrl }: { productId: number; productName: string; productUrl: string }) {
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(`${productName} — ${productUrl}`)}`;
  return (
    <div className="product-actions">
      <form action="/api/cart" method="post">
        <input type="hidden" name="productId" value={productId}/>
        <input type="hidden" name="return" value={`/products/${productId}`}/>
        <label>Quantity<input name="quantity" type="number" min="1" max="99" defaultValue="1"/></label>
        <button type="submit"><ShoppingCart/> Add to cart</button>
      </form>
      <form action="/api/wishlist" method="post">
        <input type="hidden" name="productId" value={productId}/>
        <input type="hidden" name="return" value={`/products/${productId}`}/>
        <button type="submit"><Heart/> Wishlist</button>
      </form>
      <a href={shareUrl} target="_blank" rel="noreferrer"><Share2/> Share</a>
    </div>
  );
}
