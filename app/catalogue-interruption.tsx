"use client";

import { BookOpen, ChevronLeft, ChevronRight, Flame, Percent, Sparkles, Tag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfferCountdown } from "./offer-countdown";

export type Guide = { id:number; slug:string; title:string; excerpt:string; imageUrl:string|null };
export type OfferTeaser = { id:number; title:string; description:string|null; total:number; normalTotal:number; isBundle:boolean; itemCount:number; imageUrl:string|null; endsAt:string|null };

export type Interruption =
  | { kind:"guide"; guide:Guide; guides?:Guide[] }
  | { kind:"offer"; offer:OfferTeaser; offers?:OfferTeaser[] };

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

function OfferSlide({ offer, index }: { offer: OfferTeaser; index: number }) {
  const saving = offer.normalTotal > offer.total ? offer.normalTotal - offer.total : 0;
  const blue = index % 2 === 1;
  return <article className={`offer-slide ${blue ? "is-blue" : "is-pink"}`}>
    <Link prefetch={false} className="offer-slide-card" href={`/offers#offer-${offer.id}`} aria-label={`See ${offer.title}`}>
      <span className="offer-slide-ribbon">
        {blue ? <Sparkles aria-hidden="true"/> : <Flame aria-hidden="true"/>}
        {blue ? "Special offer" : "Hot deal"}
      </span>
      <div className="offer-slide-copy">
        <strong>{offer.title}</strong>
        <p>{offer.description || (offer.isBundle ? `${offer.itemCount} products, one price.` : "Reduced while this offer runs.")}</p>
        <p className="offer-slide-price">
          {money(offer.total)}
          {saving > 0 && <del>{money(offer.normalTotal)}</del>}
        </p>
        {saving > 0 && <span className="offer-slide-badge"><small>You save</small>{money(saving)}</span>}
      </div>
      <span className="offer-slide-image" aria-hidden="true">
        {offer.imageUrl ? <img src={offer.imageUrl} alt={`${offer.title} offer`} loading="lazy" decoding="async"/> : <Percent/>}
      </span>
      <span className="offer-slide-footer">
        <OfferCountdown endsAt={offer.endsAt}/>
        <span className="offer-slide-action">View offer <ChevronRight aria-hidden="true"/></span>
      </span>
    </Link>
  </article>;
}

function GuideSlide({ guide }: { guide: Guide }) {
  return <article className={`guide-slide${guide.imageUrl ? "" : " no-art"}`}>
    <Link prefetch={false} className="guide-slide-image" href={`/blog/${guide.slug}`} aria-label={`Read ${guide.title}`}>
      {guide.imageUrl ? <img src={guide.imageUrl} alt={`${guide.title} health guide`} loading="lazy" decoding="async"/> : <BookOpen/>}
      <div className="guide-slide-copy">
        <span><BookOpen/> Health guide</span>
        <strong>{guide.title}</strong>
        <p>{guide.excerpt}</p>
        <b>Read the guide <ChevronRight/></b>
      </div>
    </Link>
  </article>;
}

function GuideRail({ guides }: { guides: Guide[] }) {
  const rail = useRef<HTMLDivElement>(null);
  const [controls, setControls] = useState({ previous: false, next: false });

  const updateControls = useCallback(() => {
    const element = rail.current;
    if (!element) return;
    const previous = element.scrollLeft > 2;
    const next = element.scrollLeft < element.scrollWidth - element.clientWidth - 2;
    setControls((current) => current.previous === previous && current.next === next ? current : { previous, next });
  }, []);

  useEffect(() => {
    updateControls();
    const element = rail.current;
    if (!element) return;
    const observer = new ResizeObserver(updateControls);
    observer.observe(element);
    return () => observer.disconnect();
  }, [guides.length, updateControls]);

  function slide(direction: -1 | 1) {
    const element = rail.current;
    if (!element) return;
    const firstCard = element.querySelector<HTMLElement>(".guide-slide");
    const distance = (firstCard?.offsetWidth ?? Math.round(element.clientWidth * 0.82)) + 14;
    element.scrollBy({ left: distance * direction, behavior: "smooth" });
  }

  return <aside className={`catalogue-break catalogue-break-guide${guides.length === 1 ? " is-single" : ""}`}>
    <header className="guide-rail-header">
      <div><span><BookOpen/> Health guides</span><strong>Helpful reads from our pharmacy</strong></div>
      {guides.length > 1 && <nav aria-label="Browse health guides">
        <button type="button" onClick={() => slide(-1)} disabled={!controls.previous} aria-label="Previous health guides"><ChevronLeft/></button>
        <button type="button" onClick={() => slide(1)} disabled={!controls.next} aria-label="Next health guides"><ChevronRight/></button>
      </nav>}
    </header>
    <div className={`guide-slider${guides.length === 1 ? " is-single" : ""}`} ref={rail} onScroll={updateControls}>
      {guides.map((guide) => <GuideSlide key={guide.id} guide={guide}/>)}
    </div>
  </aside>;
}

// A full-width break in the catalogue grid. It reads as editorial rather than as a
// product tile so the scroll has a change of rhythm instead of more of the same.
export function CatalogueInterruption({ item }: { item: Interruption }) {
  if (item.kind === "guide") {
    const guides = item.guides && item.guides.length ? item.guides : [item.guide];
    return <GuideRail guides={guides}/>;
  }

  if (item.kind === "offer") {
    const list = item.offers && item.offers.length ? item.offers : [item.offer];
    return <aside className={`catalogue-break catalogue-break-offer${list.length === 1 ? " is-single" : ""}`}>
      <header className="offer-rail-header">
        <span><Tag/> {list.length === 1 && list[0].isBundle ? "Collection offer" : "Offers on now"}</span>
        <Link prefetch={false} href="/offers">View all offers <ChevronRight/></Link>
      </header>
      <div className={`offer-slider${list.length === 1 ? " is-single" : ""}`}>
        {list.map((offer, index) => <OfferSlide key={offer.id} offer={offer} index={index}/>)}
      </div>
    </aside>;
  }

  return null;
}
