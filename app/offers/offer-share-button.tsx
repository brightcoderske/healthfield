"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

export function OfferShareButton({ slug, title, labelled=false }: { slug:string; title:string; labelled?:boolean }) {
  const [copied,setCopied]=useState(false);

  async function share() {
    const url = new URL(`/offers/${encodeURIComponent(slug)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title, text:`${title} from Healthfield Pharmacy`, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(()=>setCopied(false),1600); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await navigator.clipboard.writeText(url).catch(()=>undefined);
      setCopied(true);window.setTimeout(()=>setCopied(false),1600);
    }
  }

  return <button className={labelled?"offer-share labelled":"offer-share"} type="button" data-share-path={`/offers/${encodeURIComponent(slug)}`} onClick={share} aria-label={`Share ${title}`} title="Share this offer">{copied?<Check/>:<Share2/>}{labelled?<span>{copied?"Link copied":"Share offer"}</span>:null}</button>;
}
