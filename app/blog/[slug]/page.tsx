import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError, backendPublicJson } from "@/lib/backend-api";
import { RichText } from "@/app/products/rich-text";
import { BlogProductPromo, type PromoProduct } from "../blog-product-promo";

type Post = { title:string; excerpt:string; content:string; imageUrl:string|null; metaTitle:string|null; metaDescription:string|null; publishedAt:string|null };
type Article = { post: Post; products?: PromoProduct[] };

async function get(slug: string): Promise<Article | null> {
  try { return await backendPublicJson<Article>(`/v1/views/blogs/${encodeURIComponent(slug)}`, 300); }
  catch (error) { if (error instanceof BackendError && error.status === 404) return null; throw error; }
}

// Spreads the promoted products through the body instead of stacking them at the
// end, so each one appears at a natural break in the reading flow.
function layout(content: string, promoCount: number) {
  const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (promoCount < 1 || blocks.length < 2) return { blocks, slots: [] as number[] };
  const step = Math.max(1, Math.floor(blocks.length / (promoCount + 1)));
  const slots: number[] = [];
  for (let index = 1; index <= promoCount; index += 1) {
    const position = Math.min(blocks.length - 1, index * step);
    if (!slots.includes(position)) slots.push(position);
  }
  return { blocks, slots };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await get((await params).slug);
  return data ? { title: data.post.metaTitle || data.post.title, description: data.post.metaDescription || data.post.excerpt } : {};
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const data = await get(slug);
  if (!data) notFound();
  const { post } = data;
  const promoted = data.products || [];
  const { blocks, slots } = layout(post.content, promoted.length);
  return <main className="blog-article">
    <header>
      <Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={210} height={75}/></Link>
      <Link href="/blog">← Health guide</Link>
    </header>
    <article>
      <span>Pharmacist health guide</span>
      <h1>{post.title}</h1>
      <p className="lead">{post.excerpt}</p>
      {post.imageUrl && <img src={post.imageUrl} alt={post.title}/>}
      {blocks.map((block, index) => {
        const promoIndex = slots.indexOf(index);
        return <div key={index}>
          {promoIndex > -1 && promoted[promoIndex] && <BlogProductPromo product={promoted[promoIndex]} returnTo={`/blog/${slug}`}/>}
          <RichText value={block}/>
        </div>;
      })}
      {/* Anything that did not fit a break (very short articles) still gets shown. */}
      {promoted.slice(slots.length).map((product) => <BlogProductPromo key={product.id} product={product} returnTo={`/blog/${slug}`}/>)}
      <aside>Health information is general and does not replace diagnosis or advice from your doctor or pharmacist.</aside>
    </article>
  </main>;
}
