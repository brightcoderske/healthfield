import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Package, Percent, Tag } from "lucide-react";
import { backendPublicJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offers", description: "Current promotions and product bundles from Healthfield Pharmacy." };

type OfferItem = { productId:number; name:string; imageUrl:string|null; quantity:number; normalPrice:number; offerPrice:number|null };
type Offer = { id:number; title:string; slug:string; description:string|null; endsAt:string|null; bundlePrice:number|null; isBundle:boolean; total:number; items:OfferItem[] };

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

export default async function OffersPage() {
  const data = await backendPublicJson<{ offers?: Offer[] }>("/v1/views/home", 30).catch(() => null);
  const offers = data?.offers || [];
  return <main className="offers-page">
    <header>
      <Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={210} height={75}/></Link>
      <Link href="/#products">← Continue shopping</Link>
    </header>
    <section className="offers-intro"><span><Percent/> Current offers</span><h1>Save on the essentials</h1><p>Live promotions from our pharmacy. Prices return to normal when an offer ends.</p></section>

    {offers.length ? <div className="offers-grid">
      {offers.map((offer) => {
        const normal = offer.items.reduce((sum, item) => sum + item.normalPrice * item.quantity, 0);
        const saving = normal > offer.total ? normal - offer.total : 0;
        return <article className="offer-card" id={`offer-${offer.id}`} key={offer.id}>
          <header>
            <span className="offer-card-flag"><Tag/> {offer.isBundle ? "Collection" : "Offer"}</span>
            {offer.endsAt && <small>Ends {new Date(offer.endsAt).toLocaleDateString("en-KE")}</small>}
          </header>
          <h2>{offer.title}</h2>
          {offer.description && <p>{offer.description}</p>}
          <ul className="offer-card-items">
            {offer.items.map((item) => <li key={item.productId}>
              <Link prefetch={false} href={`/products/${item.productId}`}>
                {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async"/> : <span><Package/></span>}
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.quantity > 1 ? `${item.quantity} × ` : ""}{offer.isBundle ? money(item.normalPrice) : <>{money(item.offerPrice ?? item.normalPrice)} <del>{money(item.normalPrice)}</del></>}</small>
                </span>
              </Link>
            </li>)}
          </ul>
          <footer>
            <div className="offer-card-price">
              <b>{money(offer.total)}</b>
              {saving > 0 && <><del>{money(normal)}</del><em>Save {money(saving)}</em></>}
            </div>
            <form action="/api/cart" method="post">
              {offer.isBundle
                ? <input type="hidden" name="offerId" value={offer.id}/>
                : <input type="hidden" name="productId" value={offer.items[0]?.productId}/>}
              <input type="hidden" name="action" value="add"/>
              <input type="hidden" name="return" value="/cart"/>
              <button type="submit">{offer.isBundle ? "Add bundle to cart" : "Add to cart"}</button>
            </form>
          </footer>
        </article>;
      })}
    </div> : <div className="offers-empty"><Percent/><strong>No offers running right now</strong><span>Check back soon — promotions are added regularly.</span><Link href="/#products">Browse the catalogue</Link></div>}
  </main>;
}
