import type { Metadata } from "next";
import { backendPublicJson } from "@/lib/backend-api";
import { BlogCatalogue } from "./blog-catalogue";

export const metadata: Metadata = {
  title: "Health and Medicine Advice",
  description: "Practical pharmacist-reviewed health, medicine and wellness information from Healthfield Pharmacy in Juja and Nairobi.",
};

type Post = { id:number; title:string; slug:string; excerpt:string; imageUrl:string|null; publishedAt:string|null; category:string|null; readMinutes?:number };

export default async function Blog() {
  // This page is prerendered at build time. An unreachable or misbehaving API used
  // to throw here and fail the entire deployment, so a backend blip took the whole
  // site down. It now degrades to an empty list and self-heals on the next
  // revalidation instead.
  const data = await backendPublicJson<{ posts: Post[] }>("/v1/views/blogs", 300, ["blogs"]).catch(() => null);
  return <BlogCatalogue posts={data?.posts ?? []}/>;
}
