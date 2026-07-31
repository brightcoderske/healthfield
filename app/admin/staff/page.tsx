import { backendJson } from "@/lib/backend-api";import { StaffManager } from "./staff-manager";export const dynamic="force-dynamic";
type Staff={id:number;firstName:string;lastName:string;email:string;phone:string|null;role:"STAFF"|"ADMIN"|"SUPER_ADMIN";homeBranchId:number|null;isActive:boolean};type Store={id:number;name:string};
export default async function StaffPage(){const {staff,stores}=await backendJson<{staff:Staff[];stores:Store[]}>("/v1/views/admin/staff");return <StaffManager initialStaff={staff} stores={stores}/>}
