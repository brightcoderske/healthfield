import type { MetadataRoute } from "next";
export default function robots():MetadataRoute.Robots{const origin=(process.env.APP_URL||"https://healthfieldpharmacy.co.ke").replace(/\/$/,"");return{rules:{userAgent:"*",allow:"/",disallow:["/admin/","/staff/","/account/","/api/"]},sitemap:`${origin}/sitemap.xml`,host:origin}}
