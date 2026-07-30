import { Heart, MapPin, Package, Upload } from "lucide-react";
import { requireRole } from "@/lib/auth";
export default async function CustomerAccount() {
  const session = await requireRole(["CUSTOMER"]);
  return <main className="customer-account"><header><a href="/">← Continue shopping</a><form action="/api/auth/logout" method="post"><button>Sign out</button></form></header><h1>Hello, {session.firstName}</h1><p>Manage your orders, prescriptions and delivery details.</p><section><a href="#orders"><Package/><strong>My orders</strong><small>Track and reorder</small></a><a href="#prescriptions"><Upload/><strong>Prescriptions</strong><small>Review status</small></a><a href="#addresses"><MapPin/><strong>Addresses</strong><small>Delivery locations</small></a><a href="#favourites"><Heart/><strong>Favourites</strong><small>Saved products</small></a></section></main>;
}
