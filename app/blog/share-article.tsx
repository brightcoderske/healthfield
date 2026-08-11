"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

/** Share row. The network links are plain hrefs; only "copy" needs the client. */
export function ShareArticle({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const encoded = encodeURIComponent(url);
  const text = encodeURIComponent(title);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable; the address bar still has it */ }
  }

  return <div className="article-share">
    <h3>Share this article</h3>
    <div>
      <a className="share-fb" href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}`} target="_blank" rel="noreferrer" aria-label="Share on Facebook">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.69.24 2.69.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>
      </a>
      <a className="share-x" href={`https://twitter.com/intent/tweet?url=${encoded}&text=${text}`} target="_blank" rel="noreferrer" aria-label="Share on X">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.5 22H2.4l7.6-8.7L1.2 2h6.8l4.7 6.2L18.9 2Zm-1.1 18.1h1.7L7.3 3.8H5.5l12.3 16.3Z"/></svg>
      </a>
      <a className="share-wa" href={`https://wa.me/?text=${text}%20${encoded}`} target="_blank" rel="noreferrer" aria-label="Share on WhatsApp">
        <svg viewBox="0 0 448 512" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zM223.9 438c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 358.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.9-186.6 184.9z"/></svg>
      </a>
      <button type="button" className="share-copy" onClick={copy} aria-label="Copy link">
        {copied ? <Check/> : <Link2/>}
      </button>
    </div>
  </div>;
}
