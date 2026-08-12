import { OfferManager, type Offer, type OfferProduct } from "@/app/admin/offers/offer-manager";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export const dynamic="force-dynamic";

export default async function StaffOffersPage(){
  await requireStaffPermission("OFFERS_MANAGE");
  const data=await backendJson<{offers:Offer[];products:OfferProduct[]}>("/v1/views/staff/offers");
  return <OfferManager initial={data.offers||[]} products={data.products||[]} backHref="/staff"/>;
}
