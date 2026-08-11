import{backendJson}from"@/lib/backend-api";import{BlogManager}from"./blog-manager";import type{PickerProduct}from"./blog-product-picker";
type Post={id:number;title:string;excerpt:string;content:string;imageUrl:string|null;metaTitle:string|null;metaDescription:string|null;isPublished:boolean;productIds?:number[]};
export default async function Page(){const{posts,products}=await backendJson<{posts:Post[];products?:PickerProduct[]}>("/v1/views/admin/blogs");return <BlogManager initial={posts} products={products||[]}/>}
