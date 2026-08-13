import { cache } from "react";
import { backendPublicJson } from "@/lib/backend-api";

export type OfferItem = {
  productId: number;
  name: string;
  imageUrl: string | null;
  quantity: number;
  normalPrice: number;
  offerPrice: number | null;
  prescriptionRequired: boolean;
};
export type Offer = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string | null;
  bundlePrice: number | null;
  isBundle: boolean;
  total: number;
  items: OfferItem[];
};

export const getLiveOffers = cache(async () => {
  const data = await backendPublicJson<{ offers?: Offer[] }>(
    "/v1/views/home",
    30,
  ).catch(() => null);
  return data?.offers || [];
});

export async function getLiveOffer(slug: string) {
  return (await getLiveOffers()).find((offer) => offer.slug === slug) || null;
}
