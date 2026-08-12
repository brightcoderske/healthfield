import Image from "next/image";
import { Pill } from "lucide-react";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

type Product={id:number;name:string;sku:string;brand:string|null;packSize:string|null;imageUrl:string|null;price:number;discountPrice:number|null;prescriptionRequired:boolean};
export const dynamic="force-dynamic";

export default async function StaffProductsPage(){
  await requireStaffPermission("PRODUCTS_VIEW");
  const {products}=await backendJson<{products:Product[]}>("/v1/views/staff/products");
  return <main className="compact-admin-page"><header><div><a href="/staff">← Dashboard</a><h1>Products</h1><p>Active catalogue and current customer prices. Product editing remains under administration.</p></div></header><div className="compact-table"><div className="compact-table-head staff-product-row"><span>Image</span><span>Product</span><span>SKU</span><span>Price</span><span>Type</span></div>{products.map((product)=><div className="compact-table-row staff-product-row" key={product.id}><span className="table-thumb">{product.imageUrl?<Image src={product.imageUrl} alt="" width={52} height={52}/>:<Pill/>}</span><span><strong>{product.name}</strong><small>{product.brand||"Healthfield"}{product.packSize?` · ${product.packSize}`:""}</small></span><span>{product.sku}</span><strong>KES {Number(product.discountPrice??product.price).toLocaleString()}</strong><span>{product.prescriptionRequired?"Prescription":"General sale"}</span></div>)}</div></main>;
}
