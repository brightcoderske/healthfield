import { desc,ne } from "drizzle-orm";
import { getDb } from "@/db";
import { branches,users } from "@/db/schema";
import { StaffManager } from "./staff-manager";
export const dynamic="force-dynamic";
export default async function StaffPage(){const db=getDb();const [staff,stores]=await Promise.all([db.select({id:users.id,firstName:users.firstName,lastName:users.lastName,email:users.email,phone:users.phone,role:users.role,homeBranchId:users.homeBranchId,isActive:users.isActive}).from(users).where(ne(users.role,"CUSTOMER")).orderBy(desc(users.createdAt)),db.select({id:branches.id,name:branches.name}).from(branches)]);return <StaffManager initialStaff={staff as Array<(typeof staff)[number]&{role:"STAFF"|"ADMIN"|"SUPER_ADMIN"}>} stores={stores}/>}
