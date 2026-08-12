import { InventoryManager } from "@/app/admin/inventory/inventory-manager";
import { backendJson } from "@/lib/backend-api";

export const dynamic="force-dynamic";
type Product={id:number;name:string;imageUrl:string|null;brand:string|null;packSize:string|null;isActive:boolean;sold:number;stores:Array<{id:number;productId:number;branchId:number;branch:string;available:number;reserved:number;reorder:number}>};

export default async function StaffInventoryPage(){
  const {products,branch}=await backendJson<{products:Product[];branch:{id:number;name:string}}>("/v1/views/staff/inventory");
  return <InventoryManager initialProducts={products} backHref="/staff" scopeLabel={branch.name}/>;
}
