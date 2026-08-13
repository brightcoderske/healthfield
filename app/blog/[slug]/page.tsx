import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError, backendPublicJson } from "@/lib/backend-api";
import { RichText } from "@/app/products/rich-text";
import { BlogProductPromo, type PromoProduct } from "../blog-product-promo";
import { ShareArticle } from "../share-article";
import { PublicFooter, type PublicContact } from "@/app/public-footer";
import { getSession } from "@/lib/auth";
import { ArrowLeft, MessageCircle } from "lucide-react";

type Post = { title:string; excerpt:string; content:string; imageUrl:string|null; metaTitle:string|null; metaDescription:string|null; publishedAt:string|null; category:string|null };
type Article = { post: Post; products?: PromoProduct[] };

async function get(slug: string): Promise<Article | null> {
  try { return await backendPublicJson<Article>(`/v1/views/blogs/${encodeURIComponent(slug)}`, 300, [`blog:${slug}`]); }
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
  const slug = (await params).slug;
  const data = await get(slug);
  if (!data) return {};
  const title = data.post.metaTitle || data.post.title;
  const description = data.post.metaDescription || data.post.excerpt;
  const path = `/blog/${slug}`;
  const image = data.post.imageUrl || "/healthfield-hero-pharmacist.png";
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      siteName: "Healthfield Pharmacy",
      title,
      description,
      url: path,
      images: [{ url: image, alt: data.post.title }],
      publishedTime: data.post.publishedAt || undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  // The site footer needs contact details; a failure there must not lose the article.
  const [data, home, session] = await Promise.all([
    get(slug),
    backendPublicJson<{ contact: PublicContact }>("/v1/views/home", 60).catch(() => null),
    getSession().catch(() => null),
  ]);
  if (!data) notFound();
  const { post } = data;
  const origin = (process.env.APP_URL || (process.env.NODE_ENV === "production" ? "https://healthfieldpharmacy.co.ke" : "http://localhost:3000")).replace(/\/$/, "");
  const shareUrl = `${origin}/blog/${encodeURIComponent(slug)}`;
  const promoted = data.products || [];
  const { blocks, slots } = layout(post.content, promoted.length);
  return <>
  <main className="blog-article">
    {/* Hero: the artwork carries the headline rather than sitting above it. */}
    <div className={`article-hero${post.imageUrl ? "" : " no-art"}`}>
      {post.imageUrl && <img src={post.imageUrl} alt=""/>}
      <Link className="article-hero-back" href="/blog"><ArrowLeft/> Back to all blogs</Link>
      <div>
        {post.category && <span className="article-hero-badge">{post.category}</span>}
        <h1>{post.title}</h1>
        <p>{post.excerpt}</p>
        <small>By Healthfield Pharmacy Team{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString("en-KE", { month: "short", day: "numeric", year: "numeric" })}` : ""}</small>
      </div>
    </div>

    <div className="article-layout">
      <article>
        <div className="article-body">
          {blocks.map((block, index) => {
            const promoIndex = slots.indexOf(index);
            return <div key={index}>
              {promoIndex > -1 && promoted[promoIndex] && <BlogProductPromo product={promoted[promoIndex]} returnTo={`/blog/${slug}`}/>}
              <RichText value={block}/>
            </div>;
          })}
          {promoted.slice(slots.length).map((product) => <BlogProductPromo key={product.id} product={product} returnTo={`/blog/${slug}`}/>)}
          <aside className="article-disclaimer">Health information is general and does not replace diagnosis or advice from your doctor or pharmacist.</aside>
        </div>
      </article>

      <aside className="article-rail">
        <section className="article-advice">
          <h3>Need health advice?</h3>
          <p>Our pharmacists are here to help you live healthier every day.</p>
          <Link prefetch={false} href="/chat"><MessageCircle/> Chat with a Pharmacist</Link>
        </section>
        <ShareArticle url={shareUrl} title={post.title} summary={post.excerpt}/>
      </aside>
    </div>
  </main>
  {home?.contact && <PublicFooter contact={home.contact} signedIn={!!session}/>}
  </>;
}
