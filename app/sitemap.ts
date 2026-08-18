import type { MetadataRoute } from "next";
import { backendPublicJson } from "@/lib/backend-api";

export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const origin=(process.env.APP_URL||"https://healthfieldpharmacy.co.ke").replace(/\/$/,"");
  const staticPaths=["","/about","/contact","/faq","/conditions","/prescriptions/upload","/prescriptions/consult","/shipping-policy","/returns-policy","/privacy-policy","/terms","/blog","/pharmacy/juja","/pharmacy/nairobi-cbd","/pharmacy/nairobi","/pharmacy/thika","/pharmacy/kahawa-west","/pharmacy/thika-road"];
  let products:Array<{id:number;updatedAt:string}>=[],posts:Array<{slug:string;updatedAt:string}>=[],stores:Array<{name:string;code:string;updatedAt:string}>=[];
  try{[products,posts,stores]=await Promise.all([backendPublicJson<{products:Array<{id:number;updatedAt:string}>}>("/v1/views/sitemap",300).then(value=>value.products),backendPublicJson<{posts:Array<{slug:string;updatedAt:string}>}>("/v1/views/blogs",300).then(value=>value.posts),backendPublicJson<{stores:Array<{name:string;code:string;updatedAt:string}>}>("/v1/views/locations",300).then(value=>value.stores)]);}catch{}
  const slug=(value:string)=>value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  return [...staticPaths.map(path=>({url:`${origin}${path}`,lastModified:new Date(),changeFrequency:path===""?"daily" as const:"monthly" as const,priority:path===""?1:path.startsWith("/pharmacy/")?.85:.6})),...stores.map(store=>({url:`${origin}/pharmacy/${slug(store.name)}-${slug(store.code)}`,lastModified:new Date(store.updatedAt),changeFrequency:"weekly" as const,priority:.9})),...products.map(product=>({url:`${origin}/products/${product.id}`,lastModified:new Date(product.updatedAt),changeFrequency:"weekly" as const,priority:.8})),...posts.map(post=>({url:`${origin}/blog/${post.slug}`,lastModified:new Date(post.updatedAt),changeFrequency:"monthly" as const,priority:.7}))];
}
