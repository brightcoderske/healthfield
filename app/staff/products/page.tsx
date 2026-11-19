import type { ComponentProps } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Pill } from "lucide-react";
import { ProductManager } from "@/app/admin/products/product-manager";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { hasStaffPermission } from "@/lib/staff-permissions";

type Product={id:number;name:string;sku:string;brand:string|null;packSize:string|null;imageUrl:string|null;price:number;discountPrice:number|null;prescriptionRequired:boolean};
type EditorData={products:ComponentProps<typeof ProductManager>["initialProducts"];categories:ComponentProps<typeof ProductManager>["categories"];conditions:ComponentProps<typeof ProductManager>["conditions"]};
export const dynamic="force-dynamic";

// One page for both permissions: PRODUCTS_MANAGE gets the product editor (without buying prices,
// stock or delete, which the API refuses to staff anyway), PRODUCTS_VIEW alone gets the read-only list.
export default async function StaffProductsPage(){
  const session=await requireRole(["STAFF","ADMIN","SUPER_ADMIN"]);
  if(hasStaffPermission(session.role,session.permissions,"PRODUCTS_MANAGE")){
    const data=await backendJson<EditorData>("/v1/views/staff/product-editor");
    return <ProductManager initialProducts={data.products} categories={data.categories} conditions={data.conditions} canEditCost={false} canDelete={false} backHref="/staff"/>;
  }
  if(!hasStaffPermission(session.role,session.permissions,"PRODUCTS_VIEW"))redirect("/unauthorized");
  const {products}=await backendJson<{products:Product[]}>("/v1/views/staff/products");
  return <main className="compact-admin-page"><header><div><a href="/staff">← Dashboard</a><h1>Products</h1><p>Active catalogue and current customer prices. Product editing remains under administration.</p></div></header><div className="compact-table"><div className="compact-table-head staff-product-row"><span>Image</span><span>Product</span><span>SKU</span><span>Price</span><span>Type</span></div>{products.map((product)=><div className="compact-table-row staff-product-row" key={product.id}><span className="table-thumb">{product.imageUrl?<Image src={product.imageUrl} alt="" width={52} height={52}/>:<Pill/>}</span><span><strong>{product.name}</strong><small>{product.brand||"Healthfield"}{product.packSize?` · ${product.packSize}`:""}</small></span><span>{product.sku}</span><strong>KES {Number(product.discountPrice??product.price).toLocaleString()}</strong><span>{product.prescriptionRequired?"Prescription":"General sale"}</span></div>)}</div></main>;
}
