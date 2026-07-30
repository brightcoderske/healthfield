import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { branches } from "@/db/schema";
import { StoreManager } from "./store-manager";
export const dynamic="force-dynamic";
export default async function StoresPage(){const stores=await getDb().select().from(branches).orderBy(desc(branches.createdAt));return <StoreManager initialStores={stores}/>}
