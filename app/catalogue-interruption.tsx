"use client";

import { BookOpen, Package, Percent, Sparkles } from "lucide-react";
import Link from "next/link";
import { OfferCountdown } from "./offer-countdown";

export type Guide = { id:number; slug:string; title:string; excerpt:string; imageUrl:string|null };
export type SuggestedProduct = { id:number; name:string; imageUrl:string|null; price:number; discountPrice:number|null; conditionName:string|null };
export type OfferTeaser = { id:number; title:string; description:string|null; total:number; normalTotal:number; isBundle:boolean; itemCount:number; imageUrl:string|null; endsAt:string|null };

export type Interruption =
  | { kind:"guide"; guide:Guide }
  | { kind:"product"; product:SuggestedProduct }
  | { kind:"offer"; offer:OfferTeaser; offers?:OfferTeaser[] };

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

function OfferSlide({ offer }: { offer: OfferTeaser }) {
  const saving = offer.normalTotal > offer.total ? offer.normalTotal - offer.total : 0;
  return <article className="offer-slide">
    <Link prefetch={false} className="offer-slide-image" href={`/offers#offer-${offer.id}`} aria-label={`See ${offer.title}`}>
      {offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" decoding="async"/> : <Percent/>}
      {saving > 0 && <span className="offer-slide-badge">Save {money(saving)}</span>}
    </Link>
    <div>
      <strong>{offer.title}</strong>
      <p>{offer.description || (offer.isBundle ? `${offer.itemCount} products, one price.` : "Reduced while this offer runs.")}</p>
      <p className="offer-slide-price">
        {money(offer.total)}
        {saving > 0 && <del>{money(offer.normalTotal)}</del>}
      </p>
      <OfferCountdown endsAt={offer.endsAt}/>
      <Link prefetch={false} className="catalogue-break-cta" href={`/offers#offer-${offer.id}`}>See the offer</Link>
    </div>
  </article>;
}

// A full-width break in the catalogue grid. It reads as editorial rather than as a
// product tile so the scroll has a change of rhythm instead of more of the same.
export function CatalogueInterruption({ item }: { item: Interruption }) {
  if (item.kind === "guide") {
    const { guide } = item;
    // A poster, not a tile: the artwork fills the card and the headline sits on it.
    return <aside className={`catalogue-break catalogue-break-guide${guide.imageUrl ? "" : " no-art"}`}>
      <div className="guide-poster">
        {guide.imageUrl && <img src={guide.imageUrl} alt="" loading="lazy" decoding="async"/>}
        <div className="guide-poster-copy">
          <span className="guide-poster-flag"><BookOpen/> Health guide</span>
          <strong>{guide.title}</strong>
          <p>{guide.excerpt}</p>
          <Link prefetch={false} className="catalogue-break-cta" href={`/blog/${guide.slug}`}>Read the guide</Link>
        </div>
      </div>
    </aside>;
  }

  if (item.kind === "offer") {
    const list = item.offers && item.offers.length ? item.offers : [item.offer];

    // A lone offer is given the wide layout with a large image. Stretching a single
    // narrow card across the whole row just leaves a band of empty space.
    if (list.length === 1) {
      const offer = list[0];
      const saving = offer.normalTotal > offer.total ? offer.normalTotal - offer.total : 0;
      return <aside className="catalogue-break catalogue-break-offer">
        <span className="catalogue-break-flag"><Percent/> {offer.isBundle ? "Collection offer" : "Limited offer"}</span>
        <div className="catalogue-break-body">
          <Link prefetch={false} className="catalogue-break-image" href={`/offers#offer-${offer.id}`} aria-label={`See ${offer.title}`}>
            {offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" decoding="async"/> : <Percent/>}
          </Link>
          <div>
            <strong>{offer.title}</strong>
            <p>{offer.description || (offer.isBundle ? `${offer.itemCount} products bought together as one item.` : "Reduced while this offer runs.")}</p>
            <p className="catalogue-break-price">
              {money(offer.total)}
              {saving > 0 && <><del>{money(offer.normalTotal)}</del><em>save {money(saving)}</em></>}
            </p>
            <OfferCountdown endsAt={offer.endsAt}/>
            <Link prefetch={false} className="catalogue-break-cta" href={`/offers#offer-${offer.id}`}>See the offer</Link>
          </div>
        </div>
      </aside>;
    }

    // Several offers ride in one break: a slider showing one card on a phone and two
    // or three on a wide screen, so extra width shows more offers, not more padding.
    return <aside className="catalogue-break catalogue-break-offer">
      <span className="catalogue-break-flag"><Percent/> Offers on now</span>
      <div className="offer-slider">
        {list.map((offer) => <OfferSlide key={offer.id} offer={offer}/>)}
      </div>
    </aside>;
  }

  const { product } = item;
  const selling = product.discountPrice ?? product.price;
  // The condition gives the hook a reason to exist: "Itchy eyes? …" rather than a
  // bare advert. Products with no linked condition fall back to a neutral line.
  const hook = product.conditionName ? `${product.conditionName}?` : "Looking for something specific?";
  return <aside className="catalogue-break catalogue-break-product">
    <span className="catalogue-break-flag"><Sparkles/> Recommended for you</span>
    <div className="catalogue-break-body">
      <Link prefetch={false} className="catalogue-break-image" href={`/products/${product.id}`} aria-label={`View ${product.name}`}>
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" decoding="async"/> : <Package/>}
      </Link>
      <div>
        <strong>{hook}</strong>
        <p>Have you considered <b>{product.name}</b>? It is stocked and ready to ship from our pharmacy.</p>
        <p className="catalogue-break-price">KES {Math.round(selling).toLocaleString("en-KE")}</p>
        <Link prefetch={false} className="catalogue-break-cta" href={`/products/${product.id}`}>Inspect the product</Link>
      </div>
    </div>
  </aside>;
}
