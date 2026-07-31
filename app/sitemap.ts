import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
export const dynamic="force-dynamic";
export default async function sitemap():Promise<MetadataRoute.Sitemap>{const origin=(process.env.APP_URL||"https://healthfieldpharmacy.co.ke").replace(/\/$/,"");const staticPaths=["","/about","/contact","/faq","/conditions","/prescriptions/upload","/shipping-policy","/returns-policy","/privacy-policy","/terms"];let productRows:Array<{id:number;updatedAt:Date}>=[];try{productRows=await getDb().select({id:products.id,updatedAt:products.updatedAt}).from(products).where(eq(products.isActive,true))}catch{}return[...staticPaths.map(path=>({url:`${origin}${path}`,lastModified:new Date(),changeFrequency:path===""?"daily" as const:"monthly" as const,priority:path===""?1:.6})),...productRows.map(product=>({url:`${origin}/products/${product.id}`,lastModified:product.updatedAt,changeFrequency:"weekly" as const,priority:.8}))]}
