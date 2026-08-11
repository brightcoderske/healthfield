"use client";

import { ChevronRight, Search, ShoppingCart, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

type Post = {
  id:number; title:string; slug:string; excerpt:string; imageUrl:string|null;
  publishedAt:string|null; category:string|null; readMinutes?:number;
};

const ALL = "All Blogs";

export function BlogCatalogue({ posts }: { posts: Post[] }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState(ALL);

  // Filter pills come from the topics actually in use, so the row never advertises
  // an empty category.
  const topics = useMemo(() => {
    const used = posts.map((post) => post.category).filter((value): value is string => Boolean(value));
    return [ALL, ...[...new Set(used)].sort()];
  }, [posts]);

  const filtered = useMemo(() => posts.filter((post) =>
    (topic === ALL || post.category === topic) &&
    `${post.title} ${post.excerpt}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [posts, query, topic]);

  return <main className="blog-index">
    <header className="blog-index-bar">
      <Link className="blog-index-brand" href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={200} height={70}/></Link>
      <label className="blog-index-search">
        <Search/>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search medicines, health articles…" aria-label="Search articles"/>
      </label>
      <nav className="blog-index-actions">
        <Link href="/account"><UserRound/><span>Account</span></Link>
        <Link href="/cart"><ShoppingCart/><span>Cart</span></Link>
      </nav>
    </header>

    <nav className="blog-crumbs" aria-label="Breadcrumb">
      <Link href="/">Home</Link><ChevronRight/><span>Blogs</span>
    </nav>

    <div className="blog-index-head">
      <div>
        <h1>Health &amp; Wellness Blogs</h1>
        <p>Trusted health tips, wellness guides and pharmacy advice for you and your family.</p>
      </div>
      <label className="blog-index-filter-search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search blogs…" aria-label="Search blogs"/>
        <span><Search/> Search</span>
      </label>
    </div>

    {topics.length > 1 && <div className="blog-topics" role="tablist" aria-label="Article topics">
      {topics.map((name) => (
        <button key={name} type="button" role="tab" aria-selected={topic === name}
          className={topic === name ? "is-active" : ""} onClick={() => setTopic(name)}>{name}</button>
      ))}
    </div>}

    <section className="blog-grid">
      {filtered.map((post) => (
        <article key={post.id}>
          <Link className="blog-card-art" href={`/blog/${post.slug}`} aria-label={post.title}>
            {post.imageUrl ? <img src={post.imageUrl} alt="" loading="lazy" decoding="async"/> : <span/>}
          </Link>
          <div className="blog-card-body">
            {post.category && <span className="blog-card-badge">{post.category}</span>}
            <h2><Link href={`/blog/${post.slug}`}>{post.title}</Link></h2>
            <p>{post.excerpt}</p>
            <footer>
              <small>
                {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("en-KE", { month: "short", day: "numeric", year: "numeric" }) : ""}
                {post.readMinutes ? <> &middot; {post.readMinutes} min read</> : null}
              </small>
              <Link href={`/blog/${post.slug}`}>Read More →</Link>
            </footer>
          </div>
        </article>
      ))}
      {!filtered.length && <div className="blog-empty">
        <Search/><strong>No matching articles</strong>
        <p>Try a different health topic or medicine name.</p>
      </div>}
    </section>
  </main>;
}
