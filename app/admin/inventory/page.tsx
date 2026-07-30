import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { branchInventory, branches, orderItems, products } from "@/db/schema";
import { InventoryManager } from "./inventory-manager";
export const dynamic="force-dynamic";
export default async function InventoryPage(){
 const db=getDb();
 const [catalog,stock,sales]=await Promise.all([
  db.select({id:products.id,name:products.name,imageUrl:products.imageUrl,brand:products.brand,packSize:products.packSize,isActive:products.isActive}).from(products).orderBy(asc(products.name)),
  db.select({id:branchInventory.id,productId:branchInventory.productId,branchId:branches.id,branch:branches.name,available:branchInventory.quantityAvailable,reserved:branchInventory.quantityReserved,reorder:branchInventory.reorderLevel}).from(branchInventory).innerJoin(branches,eq(branchInventory.branchId,branches.id)),
  db.select({productId:orderItems.productId,sold:sql<number>`coalesce(sum(${orderItems.quantity}),0)`}).from(orderItems).groupBy(orderItems.productId),
 ]);
 return <InventoryManager initialProducts={catalog.map(product=>({...product,stores:stock.filter(row=>row.productId===product.id),sold:Number(sales.find(row=>row.productId===product.id)?.sold||0)}))}/>;
}
