import { ArrowLeft, Heart, Package, ShieldCheck, ShoppingCart, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { ProductActions } from "./product-actions";
import { RichText } from "../rich-text";

export const dynamic = "force-dynamic";

type Recommendation = { id: number; name: string; imageUrl: string | null; price: string; discountPrice: string | null; packSize: string | null };
type Product = {
  id: number; name: string; brand: string | null; imageUrl: string | null; price: string; discountPrice: string | null;
  packSize: string | null; shortDescription: string | null; description: string | null; usageInformation: string | null;
  warnings: string | null; storageInformation: string | null; prescriptionRequired: boolean;
};
type ProductData = { product: Product; rating: number | null; reviewCount: number; related: Recommendation[]; similar: Recommendation[]; bought: Recommendation[] };

async function currentOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || (host?.includes("localhost") || host?.startsWith("192.168.") ? "http" : "https");
  return host ? `${protocol}://${host}` : process.env.APP_URL ?? "http://localhost:3000";
}

async function dataFor(id: number) {
  try {
    return await backendJson<ProductData>(`/v1/views/products/${id}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await dataFor(Number((await params).id));
  if (!data) return { title: "Product not found" };
  const { product } = data;
  const description = product.shortDescription || `Buy ${product.name} from Healthfield Pharmacy.`;
  const origin = await currentOrigin();
  const previewImage = product.imageUrl || `${origin}/healthfield-logo-clean.png`;
  return {
    title: product.name,
    description,
    openGraph: { title: product.name, description, type: "website", images: [{ url: previewImage, alt: product.name }] },
    twitter: { card: "summary_large_image", title: product.name, description, images: [previewImage] },
  };
}

function ProductRail({ title, subtitle, items }: { title: string; subtitle: string; items: Recommendation[] }) {
  if (!items.length) return null;
  return <section className="recommendation-section">
    <header><div><h2>{title}</h2><p>{subtitle}</p></div><Link href="/#products">View more</Link></header>
    <div className="approved-products recommendation-products">{items.map((item) => <article className="approved-product" key={item.id}>
      <Link className="approved-product-main" href={`/products/${item.id}`}>
        <div className="approved-product-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <div className="product-image-missing"><Package /><small>Image pending</small></div>}</div>
        <div className="approved-product-info"><h3>{item.name}</h3>{item.packSize && <small>{item.packSize}</small>}</div>
      </Link>
      <form action="/api/wishlist" method="post" className="product-wishlist-form">
        <input type="hidden" name="productId" value={item.id} /><input type="hidden" name="return" value={`/products/${item.id}`} />
        <button className="approved-wishlist" aria-label={`Save ${item.name}`}><Heart /></button>
      </form>
      <div className="product-card-footer"><strong>KES {Number(item.discountPrice ?? item.price).toLocaleString()}</strong><form action="/api/cart" method="post">
        <input type="hidden" name="productId" value={item.id} /><input type="hidden" name="action" value="add" /><input type="hidden" name="return" value={`/products/${item.id}`} />
        <button className="approved-cart" aria-label={`Add ${item.name} to cart`}><ShoppingCart /></button>
      </form></div>
    </article>)}</div>
  </section>;
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const data = await dataFor(id);
  if (!data) notFound();
  const { product, rating, reviewCount, related, similar, bought } = data;
  const price = Number(product.discountPrice ?? product.price);
  const productUrl = `${await currentOrigin()}/products/${product.id}`;
  return <main className="product-detail">
    <Link href="/#products"><ArrowLeft /> Back to products</Link>
    <section className="product-primary">
      <div className="product-detail-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div><Package /><span>Product image has not been added</span></div>}</div>
      <div className="product-detail-copy">
        <span>{product.brand || "Healthfield Pharmacy"}</span><h1>{product.name}</h1>
        {rating && <div className="detail-rating"><Star />{rating.toFixed(1)} <small>{reviewCount} verified {reviewCount === 1 ? "review" : "reviews"}</small></div>}
        {product.packSize && <p>{product.packSize}</p>}<strong>KES {price.toLocaleString()}</strong>
        {product.shortDescription && <div className="product-description"><h2>Description</h2><p>{product.shortDescription}</p></div>}
        <div className="availability-pill">Available to order</div>
        {product.prescriptionRequired && <div className="prescription-note"><ShieldCheck />A valid prescription is required before this order can be processed. <Link href="/prescriptions/upload">Upload prescription</Link></div>}
        <ProductActions productId={product.id} productName={product.name} productUrl={productUrl} />
        <Link className="contact-pharmacy" href="/contact">Need advice? Contact our pharmacy team</Link>
      </div>
    </section>
    <section className="product-information"><h2>Product information</h2><div>
      {product.description && <article><h3>Details</h3><RichText value={product.description}/></article>}
      {product.usageInformation && <article><h3>How to use</h3><p>{product.usageInformation}</p></article>}
      {product.warnings && <article><h3>Important warnings</h3><p>{product.warnings}</p></article>}
      {product.storageInformation && <article><h3>Storage</h3><p>{product.storageInformation}</p></article>}
    </div></section>
    <ProductRail title="Frequently bought together" subtitle="Products customers often purchase in the same order." items={bought} />
    <ProductRail title="People also like" subtitle="Popular choices for similar health needs." items={similar} />
    <ProductRail title="More from this category" subtitle="Keep exploring products selected for you." items={related} />
  </main>;
}
