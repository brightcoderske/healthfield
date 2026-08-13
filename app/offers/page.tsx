import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Percent } from "lucide-react";
import { OfferCard } from "./offer-card";
import { getLiveOffers } from "./offer-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offers", description: "Current promotions and product bundles from Healthfield Pharmacy." };

export default async function OffersPage() {
  const offers = await getLiveOffers();
  return <main className="offers-page">
    <header>
      <Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={210} height={75} priority/></Link>
      <Link href="/#products">← Continue shopping</Link>
    </header>
    <section className="offers-intro"><span><Percent/> Current offers</span><h1>Save on the essentials</h1><p>Live promotions from our pharmacy. Prices return to normal when an offer ends.</p></section>

    {offers.length ? <div className="offers-grid">{offers.map((offer)=><OfferCard offer={offer} key={offer.id}/>)}</div> : <div className="offers-empty"><Percent/><strong>No offers running right now</strong><span>Check back soon — promotions are added regularly.</span><Link href="/#products">Browse the catalogue</Link></div>}
  </main>;
}
