import { cookies } from "next/headers";
import { backendJson } from "@/lib/backend-api";
import { CART_COOKIE, parseCart, parseCartOffers } from "@/lib/shopping-state";
import { CartView, type CartOffer, type PayablePrescription } from "./cart-view";
export const dynamic = "force-dynamic";
type Product = {
  id: number;
  name: string;
  price: string;
  discountPrice: string | null;
  imageUrl: string | null;
  packSize: string | null;
  prescriptionRequired: boolean;
};

export default async function CartPage() {
  const jar = await cookies();
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  const offerIds = Object.keys(
    parseCartOffers(jar.get(CART_COOKIE)?.value),
  ).map(Number);
  const ids = Object.keys(initialCart).join(",");
  const data = await backendJson<{ products: Product[]; offers?: CartOffer[] }>(
    `/v1/views/catalogue?ids=${encodeURIComponent(ids)}`,
  );
  // Bundles are resolved live, so one that ended simply stops appearing in the cart.
  const offers = (data.offers || []).filter((offer) =>
    offerIds.includes(offer.id),
  );
  // Approved prescriptions (and the medicines a consultation issued) waiting for payment sit
  // in the cart too, so paying is one click away from the place everyone looks. A visitor
  // who is not signed in simply has none.
  const prescriptions = await backendJson<{ prescriptions: PayablePrescription[] }>(
    "/v1/views/account/payable-prescriptions",
  ).then((result) => result.prescriptions).catch(() => []);
  return (
    <CartView
      initialPrescriptions={prescriptions}
      initialCatalog={data.products}
      initialCart={initialCart}
      initialOffers={offers}
    />
  );
}
