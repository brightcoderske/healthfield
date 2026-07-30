import { and, eq, sql } from "drizzle-orm";
import { ArrowLeft, Package, ShieldCheck, Star } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { productReviews, products } from "@/db/schema";
import { ProductActions } from "./product-actions";

export const dynamic = "force-dynamic";

async function currentOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || (host?.includes("localhost") || host?.startsWith("192.168.") ? "http" : "https");
  return host ? `${protocol}://${host}` : process.env.APP_URL ?? "http://localhost:3000";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number((await params).id);
  const [product] = await getDb().select({
    name: products.name,
    shortDescription: products.shortDescription,
    imageUrl: products.imageUrl,
    isActive: products.isActive,
  }).from(products).where(eq(products.id, id)).limit(1);
  if (!product?.isActive) return { title: "Product not found" };
  const description = product.shortDescription || `Buy ${product.name} from Healthfield Pharmacy.`;
  const origin = await currentOrigin();
  const previewImage = product.imageUrl || `${origin}/healthfield-logo-clean.png`;
  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      type: "website",
      images: [{ url: previewImage, alt: product.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description,
      images: [previewImage],
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product || !product.isActive) notFound();
  const [reviewSummary] = await db.select({
    rating: sql<string | null>`avg(${productReviews.rating})`,
    count: sql<number>`count(*)`,
  }).from(productReviews).where(and(eq(productReviews.productId, id), eq(productReviews.isApproved, true)));
  const rating = reviewSummary?.rating === null ? null : Number(reviewSummary?.rating);
  const reviewCount = Number(reviewSummary?.count ?? 0);
  const price = Number(product.discountPrice ?? product.price);
  const productUrl = `${await currentOrigin()}/products/${product.id}`;
  return <main className="product-detail"><a href="/#products"><ArrowLeft/> Back to products</a><section><div className="product-detail-image">{product.imageUrl?<img src={product.imageUrl} alt={product.name}/>:<div><Package/><span>Product image has not been added</span></div>}</div><div className="product-detail-copy"><span>{product.brand||"Healthfield Pharmacy"}</span><h1>{product.name}</h1>{rating&&<div className="detail-rating"><Star/>{rating.toFixed(1)} <small>{reviewCount} verified {reviewCount === 1 ? "review" : "reviews"}</small></div>}{product.packSize&&<p>{product.packSize}</p>}<strong>KES {price.toLocaleString()}</strong>{product.shortDescription&&<div className="product-description"><h2>Description</h2><p>{product.shortDescription}</p></div>}{product.prescriptionRequired&&<div className="prescription-note"><ShieldCheck/>A valid prescription is required before fulfilment.</div>}<ProductActions productId={product.id} productName={product.name} productUrl={productUrl}/></div></section></main>;
}
