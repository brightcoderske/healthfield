import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { PrescriptionUploadForm } from "./prescription-upload-form";

export const dynamic = "force-dynamic";

type Product = { id:number;name:string;packSize:string|null;prescriptionRequired:boolean };

export default async function PrescriptionUploadPage() {
  await requireRole(["CUSTOMER"]);
  const jar = await cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const ids = Object.keys(cart).join(",");
  const data = await backendJson<{ products:Product[] }>(`/v1/views/catalogue?ids=${encodeURIComponent(ids)}`);
  const linkedItems = data.products.filter((product) => product.prescriptionRequired && cart[product.id]).map((product) => ({ id:product.id,name:product.name,packSize:product.packSize,quantity:cart[product.id] }));
  return <PrescriptionUploadForm linkedItems={linkedItems} />;
}
