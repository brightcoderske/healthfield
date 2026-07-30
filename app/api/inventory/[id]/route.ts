import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { branchInventory } from "@/db/schema";
import { getSession } from "@/lib/auth";
const schema=z.object({quantityAvailable:z.number().int().nonnegative(),quantityReserved:z.number().int().nonnegative(),reorderLevel:z.number().int().nonnegative()});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 const session=await getSession();if(!session||!["ADMIN","SUPER_ADMIN"].includes(session.role))return NextResponse.json({error:"Administrator access required."},{status:403});
 const id=Number((await params).id),parsed=schema.safeParse(await request.json().catch(()=>null));if(!Number.isInteger(id)||!parsed.success)return NextResponse.json({error:"Enter valid non-negative stock quantities."},{status:400});
 await getDb().update(branchInventory).set({...parsed.data,updatedBy:session.userId}).where(eq(branchInventory.id,id));return NextResponse.json({ok:true});
}
