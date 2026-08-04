import { backendJson } from "@/lib/backend-api";

function xml(value:string|number){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");}
type Product={id:number;sku:string;name:string;description:string|null;imageUrl:string|null;price:string;discountPrice:string|null;brand:string|null;barcode:string|null;packSize:string|null;category:string;prescriptionRequired:boolean;rating:string|null;reviewCount:number};

export async function GET(){
  const origin=(process.env.APP_URL||"https://healthfieldpharmacy.co.ke").replace(/\/$/,"");
  const rows=(await backendJson<{products:Product[]}>("/v1/views/merchant")).products;
  const items=rows.filter(row=>row.imageUrl&&!row.prescriptionRequired&&!row.category.toLowerCase().includes("prescription")).map(row=>{
    const description=row.description||`${row.name}${row.packSize?` - ${row.packSize}`:""}, available from Healthfield Pharmacy.`;
    const regular=Number(row.price),sale=row.discountPrice&&Number(row.discountPrice)<regular?Number(row.discountPrice):null;
    return `<item><g:id>${xml(row.sku||`hf-${row.id}`)}</g:id><g:title>${xml(row.name)}</g:title><g:description>${xml(description)}</g:description><g:link>${origin}/products/${row.id}</g:link><g:image_link>${xml(row.imageUrl!)}</g:image_link><g:availability>in_stock</g:availability><g:price>${regular.toFixed(2)} KES</g:price>${sale!==null?`<g:sale_price>${sale.toFixed(2)} KES</g:sale_price>`:""}<g:condition>new</g:condition>${row.brand?`<g:brand>${xml(row.brand)}</g:brand>`:""}${row.barcode?`<g:gtin>${xml(row.barcode)}</g:gtin>`:`<g:mpn>${xml(row.sku||`hf-${row.id}`)}</g:mpn><g:identifier_exists>no</g:identifier_exists>`}<g:product_type>Health &amp; Beauty &gt; ${xml(row.category)}</g:product_type>${row.rating&&row.reviewCount?`<g:product_review_count>${row.reviewCount}</g:product_review_count><g:product_review_average>${Number(row.rating).toFixed(1)}</g:product_review_average>`:""}</item>`;
  }).join("");
  const feed=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Healthfield Pharmacy product feed</title><link>${origin}</link><description>Non-prescription medicines, skincare, wellness and personal-care products from Healthfield Pharmacy.</description>${items}</channel></rss>`;
  return new Response(feed,{headers:{"Content-Type":"application/xml; charset=utf-8","Cache-Control":"public, max-age=3600, stale-while-revalidate=86400"}});
}
