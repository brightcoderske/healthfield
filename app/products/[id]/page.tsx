import { ArrowLeft, Package, ShieldCheck, ShoppingCart, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BackendError, backendJson } from "@/lib/backend-api";
import { ProductActions } from "./product-actions";
import { RichText } from "../rich-text";
import Image from "next/image";
import { ProductReviewForm } from "@/app/product-review-form";
import { ProductCard } from "@/app/product-card";
import { PublicFooter, type PublicContact } from "@/app/public-footer";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Recommendation = { id: number; name: string; imageUrl: string | null; price: string; discountPrice: string | null; packSize: string | null };
type Product = {
  id: number; name: string; brand: string | null; imageUrl: string | null; price: string; discountPrice: string | null;
  packSize: string | null; shortDescription: string | null; description: string | null; usageInformation: string | null;
  warnings: string | null; storageInformation: string | null; prescriptionRequired: boolean;
};
type ProductData = { product: Product; rating: number | null; reviewCount: number; reviews:Array<{id:number;rating:number;comment:string|null;createdAt:string;firstName:string}>; related: Recommendation[]; similar: Recommendation[]; bought: Recommendation[] };

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
  const description = product.description || `Buy ${product.name} from Healthfield Pharmacy.`;
  const origin = await currentOrigin();
  const previewImage = product.imageUrl || `${origin}/healthfield-logo-clean.png`;
  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.id}` },
    openGraph: { title: product.name, description, type: "website", images: [{ url: previewImage, alt: product.name }] },
    twitter: { card: "summary_large_image", title: product.name, description, images: [previewImage] },
  };
}

function ProductRail({ title, subtitle, items }: { title: string; subtitle: string; items: Recommendation[] }) {
  if (!items.length) return null;
  return <section className="recommendation-section">
    <header><div><h2>{title}</h2><p>{subtitle}</p></div><Link href="/#products">View more</Link></header>
    <div className="approved-products recommendation-products">{items.map((item) => <ProductCard key={item.id} product={item} returnTo={`/products/${item.id}`} />)}</div>
  </section>;
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [data, home, session] = await Promise.all([dataFor(id), backendJson<{contact:PublicContact}>("/v1/views/home").catch(()=>null), getSession()]);
  if (!data) notFound();
  const { product, rating, reviewCount, reviews, related, similar, bought } = data;
  const price = Number(product.discountPrice ?? product.price);
  const regularPrice = Number(product.price);
  const discountPercent = product.discountPrice && regularPrice > Number(product.discountPrice) ? Math.round((1 - Number(product.discountPrice) / regularPrice) * 100) : 0;
  const productUrl = `${await currentOrigin()}/products/${product.id}`;
  const productSchema={"@context":"https://schema.org","@type":"Product",name:product.name,description:product.description||`Buy ${product.name} from Healthfield Pharmacy.`,image:product.imageUrl?[product.imageUrl]:undefined,brand:{"@type":"Brand",name:product.brand||"Healthfield Pharmacy"},offers:{"@type":"Offer",url:productUrl,priceCurrency:"KES",price,availability:"https://schema.org/InStock",itemCondition:"https://schema.org/NewCondition",seller:{"@type":"Organization",name:"Healthfield Pharmacy"}},...(rating&&reviewCount?{aggregateRating:{"@type":"AggregateRating",ratingValue:rating,reviewCount}}:{})};
  return <><main className="product-detail"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(productSchema).replace(/</g,"\\u003c")}}/>
    <header className="product-page-header"><Link className="product-header-back" href="/#products"><ArrowLeft /><span>Back to products</span></Link><Link className="product-header-logo" href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={205} height={72}/></Link><Link className="product-header-cart" href="/cart"><ShoppingCart/><span>View cart</span></Link></header>
    <section className="product-primary">
      <div className="product-detail-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div><Package /><span>Product image has not been added</span></div>}</div>
      <div className="product-detail-copy">
        <span>{product.brand || "Healthfield Pharmacy"}</span><h1>{product.name}</h1>
        {rating && <div className="detail-rating"><Star />{rating.toFixed(1)} <small>{reviewCount} verified {reviewCount === 1 ? "review" : "reviews"}</small></div>}
        {product.packSize && <p>{product.packSize}</p>}
        <div className="product-price-row"><strong>KES {price.toLocaleString()}</strong>{discountPercent>0&&<><del>KES {regularPrice.toLocaleString()}</del><span className="detail-discount">Save {discountPercent}%</span></>}<span className="availability-pill">Available to order</span></div>
        {product.prescriptionRequired && <div className="prescription-note"><ShieldCheck />A valid prescription is required before this order can be processed. <Link href="/prescriptions/upload">Upload prescription</Link></div>}
        <ProductActions productId={product.id} productName={product.name} productUrl={productUrl} />
        <Link className="contact-pharmacy" href="/contact">Need advice? Contact our pharmacy team</Link>
      </div>
    </section>
    <section className="product-information"><h2>Product information</h2><div>
      {product.description ? <article><h3>Description</h3><RichText value={product.description}/></article> : <p className="product-description-empty">Product description has not been added yet.</p>}
      {product.usageInformation && <article><h3>How to use</h3><p>{product.usageInformation}</p></article>}
      {product.warnings && <article><h3>Important warnings</h3><p>{product.warnings}</p></article>}
      {product.storageInformation && <article><h3>Storage</h3><p>{product.storageInformation}</p></article>}
    </div></section>
    <section className="product-reviews"><header><div><h2>Customer reviews</h2><p>{reviewCount ? `${rating?.toFixed(1)} from ${reviewCount} verified customer reviews` : "Be the first verified customer to review this product."}</p></div></header><div className="review-grid"><ProductReviewForm productId={product.id}/><div className="review-list">{reviews.map(review=><article key={review.id}><span>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</span><strong>{review.rating===5?"Recommend":review.rating===4?"Very good":review.rating===3?"Good":review.rating===2?"Fair":"Poor"}</strong><p>{review.comment}</p><small>{review.firstName} · verified purchase · {new Date(review.createdAt).toLocaleDateString("en-KE")}</small></article>)}</div></div></section>
    <ProductRail title="Frequently bought together" subtitle="Products customers often purchase in the same order." items={bought} />
    <ProductRail title="People also like" subtitle="Popular choices for similar health needs." items={similar} />
    <ProductRail title="More from this category" subtitle="Keep exploring products selected for you." items={related} />
  </main>{home?.contact&&<PublicFooter contact={home.contact} signedIn={!!session}/>}</>;
}
