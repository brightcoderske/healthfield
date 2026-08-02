import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { WalkInSaleForm } from "@/app/walk-in-sale-form";
export const dynamic="force-dynamic";
type Data={branches:Array<{id:number;name:string}>;products:Array<{id:number;name:string;sku:string;price:number;discountPrice:number|null}>;stock:Array<{branchId:number;productId:number;available:number}>};
export default async function AdminWalkInSalesPage(){await requireRole(["ADMIN","SUPER_ADMIN"]);const data=await backendJson<Data>("/v1/views/walk-in-sale");return <WalkInSaleForm {...data}/>}
