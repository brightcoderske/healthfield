/* eslint-disable @next/next/no-img-element */
import { BookOpen, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Guide } from "./catalogue-interruption";

/**
 * A few blog articles on the homepage, after the products.
 *
 * A plain grid that reads down the page (two across on a phone, four on a wider screen), not
 * another sideways slider: the interruption cards in the catalogue already slide, and a section
 * that is meant to be glanced at should not need swiping to see what it holds.
 */
export function HomeBlogGrid({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <section className="home-blogs" aria-labelledby="home-blogs-title">
      <header>
        <div>
          <span><BookOpen aria-hidden="true" /> Health &amp; wellness blog</span>
          <h2 id="home-blogs-title">Helpful reads from our pharmacy</h2>
        </div>
        <Link prefetch={false} href="/blog">View all blogs <ChevronRight aria-hidden="true" /></Link>
      </header>
      <div className="home-blogs-grid">
        {guides.map((guide) => (
          <article key={guide.id}>
            <Link prefetch={false} href={`/blog/${guide.slug}`}>
              <span className="home-blog-art">
                {guide.imageUrl ? <img src={guide.imageUrl} alt="" loading="lazy" decoding="async" /> : <BookOpen aria-hidden="true" />}
              </span>
              <span className="home-blog-copy">
                <strong>{guide.title}</strong>
                {guide.excerpt ? <small>{guide.excerpt}</small> : null}
                <b>Read article <ChevronRight aria-hidden="true" /></b>
              </span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
