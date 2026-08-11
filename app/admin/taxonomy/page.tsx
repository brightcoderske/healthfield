import { backendJson } from "@/lib/backend-api";
import { TaxonomyManager } from "./taxonomy-manager";
export const dynamic="force-dynamic";
type Item={id:number;name:string;description?:string|null;featuredOnStorefront?:boolean};
export default async function TaxonomyPage(){const data=await backendJson<{products:unknown[];categories:Item[];conditions:Item[]}>("/v1/views/admin/products");return <TaxonomyManager initialCategories={data.categories} initialConditions={data.conditions}/>}
