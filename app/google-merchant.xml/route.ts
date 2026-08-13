import { backendJson } from "@/lib/backend-api";
import { buildGoogleMerchantFeed, type MerchantProduct } from "@/lib/google-merchant-feed";

export async function GET(){
  const origin=(process.env.APP_URL||"https://healthfieldpharmacy.co.ke").replace(/\/$/,"");
  const rows=(await backendJson<{products:MerchantProduct[]}>("/v1/views/merchant")).products;
  const result=buildGoogleMerchantFeed(rows,origin);
  return new Response(result.feed,{headers:{
    "Content-Type":"application/xml; charset=utf-8",
    "Cache-Control":"public, max-age=300, stale-while-revalidate=300",
    "X-Merchant-Source-Products":String(result.sourceCount),
    "X-Merchant-Feed-Products":String(result.itemCount),
    "X-Merchant-Missing-Images":String(result.missingImageCount),
    "X-Merchant-Invalid-Prices":String(result.invalidPriceCount),
  }});
}
