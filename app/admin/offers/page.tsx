import { backendJson } from "@/lib/backend-api";
import { OfferManager, type Offer, type OfferProduct } from "./offer-manager";

export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const data = await backendJson<{ offers: Offer[]; products: OfferProduct[] }>("/v1/views/admin/offers");
  return <OfferManager initial={data.offers || []} products={data.products || []}/>;
}
