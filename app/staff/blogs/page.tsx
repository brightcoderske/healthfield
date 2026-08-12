import { BlogManager } from "@/app/admin/blogs/blog-manager";
import type { PickerProduct } from "@/app/admin/blogs/blog-product-picker";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

type Post={id:number;title:string;excerpt:string;content:string;imageUrl:string|null;metaTitle:string|null;metaDescription:string|null;isPublished:boolean;category?:string|null;productIds?:number[]};

export const dynamic="force-dynamic";

export default async function StaffBlogsPage(){
  await requireStaffPermission("BLOGS_MANAGE");
  const {posts,products}=await backendJson<{posts:Post[];products:PickerProduct[]}>("/v1/views/staff/blogs");
  return <BlogManager initial={posts} products={products||[]} backHref="/staff"/>;
}
