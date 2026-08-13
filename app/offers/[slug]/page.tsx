import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OfferCard } from "../offer-card";
import { getLiveOffer } from "../offer-data";

type Props = { params:Promise<{slug:string}> };

export const dynamic = "force-dynamic";

export async function generateMetadata({params}:Props):Promise<Metadata> {
  const {slug}=await params;
  const offer=await getLiveOffer(slug);
  if(!offer)return {title:"Offer unavailable"};
  const description=offer.description||`Save on ${offer.title} at Healthfield Pharmacy.`;
  return {
    title:offer.title,
    description,
    openGraph:{title:offer.title,description,type:"website",url:`/offers/${offer.slug}`,images:offer.imageUrl?[{url:offer.imageUrl,alt:`${offer.title} offer`}]:[]},
    twitter:{card:"summary_large_image",title:offer.title,description,images:offer.imageUrl?[offer.imageUrl]:[]},
  };
}

export default async function SharedOfferPage({params}:Props) {
  const {slug}=await params;
  const offer=await getLiveOffer(slug);
  if(!offer)notFound();
  return <main className="offers-page shared-offer-page">
    <header><Link href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={210} height={75} priority/></Link><Link href="/offers">← All offers</Link></header>
    <section className="shared-offer-intro"><span>Healthfield advertised offer</span><h1>{offer.title}</h1><p>Share this exact offer or add it directly to your cart.</p></section>
    <OfferCard offer={offer} showArtwork/>
  </main>;
}
