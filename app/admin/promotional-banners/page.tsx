import { backendJson } from "@/lib/backend-api";
import { PromotionalBannerManager, type BannerProduct, type PromotionalBanner } from "./promotional-banner-manager";

export const dynamic = "force-dynamic";

export default async function PromotionalBannersPage() {
  const data = await backendJson<{ banners: PromotionalBanner[]; products: BannerProduct[] }>("/v1/views/admin/promotional-banners");
  return <PromotionalBannerManager initial={data.banners || []} products={data.products || []}/>;
}
