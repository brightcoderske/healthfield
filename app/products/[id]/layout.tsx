import { backendJson } from "@/lib/backend-api";
import { richTextToPlainText } from "@/lib/rich-text-content";

export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  let data: { product: { id: number; name: string; description: string | null; shortDescription: string | null; imageUrl: string | null; sku: string; barcode: string | null; brand: string | null; price: string; discountPrice: string | null }; rating: number | null; reviewCount: number } | null = null;
  try { data = await backendJson(`/v1/views/products/${id}`); } catch {}
  if (!data) return children;
  const { product, rating, reviewCount } = data;
  const origin = (process.env.APP_URL || "https://healthfieldpharmacy.co.ke").replace(/\/$/, "");
  const price = Number(product.discountPrice ?? product.price);
  const description = product.description
    ? richTextToPlainText(product.description)
    : product.shortDescription || `Buy ${product.name} from Healthfield Pharmacy.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: product.imageUrl ? [product.imageUrl] : undefined,
    sku: product.sku,
    gtin: product.barcode || undefined,
    brand: { "@type": "Brand", name: product.brand || "Healthfield Pharmacy" },
    offers: { "@type": "Offer", url: `${origin}/products/${product.id}`, priceCurrency: "KES", price: price.toFixed(2), availability: "https://schema.org/InStock", itemCondition: "https://schema.org/NewCondition" },
    aggregateRating: rating && reviewCount ? { "@type": "AggregateRating", ratingValue: rating.toFixed(1), reviewCount } : undefined,
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}/>{children}</>;
}
