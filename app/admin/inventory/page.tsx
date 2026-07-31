import { backendJson } from "@/lib/backend-api";import { InventoryManager } from "./inventory-manager";export const dynamic="force-dynamic";
type Product={id:number;name:string;imageUrl:string|null;brand:string|null;packSize:string|null;isActive:boolean;sold:number;stores:Array<{id:number;productId:number;branchId:number;branch:string;available:number;reserved:number;reorder:number}>};
export default async function InventoryPage(){const {products}=await backendJson<{products:Product[]}>("/v1/views/admin/inventory");return <InventoryManager initialProducts={products}/>}
