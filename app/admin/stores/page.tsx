import { backendJson } from "@/lib/backend-api";import { StoreManager } from "./store-manager";export const dynamic="force-dynamic";
type Store={id:number;name:string;code:string;phone:string;email:string|null;address:string;isActive:boolean};
export default async function StoresPage(){const {stores}=await backendJson<{stores:Store[]}>("/v1/views/admin/stores");return <StoreManager initialStores={stores}/>}
