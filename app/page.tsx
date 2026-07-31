import { Storefront } from "./storefront";
import { getSession } from "@/lib/auth";
import { backendJson } from "@/lib/backend-api";
import { cookies } from "next/headers";
import { CART_COOKIE, parseCart, parseWishlist, WISHLIST_COOKIE } from "@/lib/shopping-state";

export const dynamic = "force-dynamic";

type HomeData = {
  catalog: Array<{ id:number; name:string; price:number; imageUrl:string|null; packSize:string|null; brand:string|null; categoryId:number; shortDescription:string|null; conditionIds:number[]; rating:number|null; reviewCount:number; discountPrice:number|null }>;
  contact: { phone:string; whatsapp:string; supportEmail:string; address:string; openingHours:string; deliveryMessage:string; facebookUrl:string; instagramUrl:string; xUrl:string; tiktokUrl:string };
  categories: Array<{id:number;name:string;slug:string}>;
  conditions: Array<{id:number;name:string;slug:string}>;
};

export default async function Home({ searchParams }: { searchParams: Promise<{ offers?: string }> }) {
  const homeData = backendJson<HomeData>("/v1/views/home").catch(() => null);
  const [data, session, jar, params] = await Promise.all([homeData, getSession(), cookies(), searchParams]);
  let catalog: Array<{
    id: number;
    name: string;
    price: number;
    imageUrl: string | null;
    packSize: string | null;
    brand: string | null;
    categoryId: number;
    shortDescription: string | null;
    conditionIds: number[];
    rating: number | null;
    reviewCount: number;
    discountPrice: number | null;
  }> = [];
  let contact = { phone: "", whatsapp: "", supportEmail:"", address:"", openingHours:"", deliveryMessage: "Fast Delivery Across Kenya", facebookUrl: "", instagramUrl: "", xUrl: "", tiktokUrl: "" };
  let categoryRows: Array<{ id: number; name: string; slug: string }> = [];
  let conditionRows: Array<{ id: number; name: string; slug: string }> = [];
  if (data) {
    catalog = data.catalog;
    contact = data.contact;
    categoryRows = data.categories;
    conditionRows = data.conditions;
  }
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  const initialWishlist = parseWishlist(jar.get(WISHLIST_COOKIE)?.value);
  const offersOnly = params.offers === "1";
  return <Storefront initialProducts={catalog} initialCategories={categoryRows} initialConditions={conditionRows} contact={contact} viewer={session ? { firstName: session.firstName, role: session.role } : null} offersOnly={offersOnly} initialCart={initialCart} initialWishlist={initialWishlist} />;
}
