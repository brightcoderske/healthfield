import { Storefront } from "./storefront";
import { randomInt } from "node:crypto";
import { getSession } from "@/lib/auth";
import { backendPublicJson } from "@/lib/backend-api";
import { cookies } from "next/headers";
import { CART_COOKIE, parseCart, parseWishlist, WISHLIST_COOKIE } from "@/lib/shopping-state";

export const dynamic = "force-dynamic";

type HomeData = {
  catalog: Array<{ id:number; name:string; price:number; imageUrl:string|null; packSize:string|null; brand:string|null; categoryId:number; shortDescription:string|null; description:string|null; conditionIds:number[]; rating:number|null; reviewCount:number; discountPrice:number|null }>;
  contact: { phone:string; whatsapp:string; supportEmail:string; address:string; openingHours:string; deliveryMessage:string; facebookUrl:string; instagramUrl:string; xUrl:string; tiktokUrl:string;licenceTitle:string;licenceNumber:string;licenceImageUrl:string|null };
  categories: Array<{id:number;name:string;slug:string}>;
  conditions: Array<{id:number;name:string;slug:string}>;
  guides?: Array<{id:number;slug:string;title:string;excerpt:string;imageUrl:string|null}>;
  offers?: Array<{id:number;title:string;description:string|null;total:number;isBundle:boolean;imageUrl:string|null;endsAt:string|null;items:Array<{quantity:number;normalPrice:number}>}>;
  promotions?: Array<{id:number;title:string;imageUrl:string;productId:number;productName:string}>;
};

export default async function Home({ searchParams }: { searchParams: Promise<{ offers?: string; category?: string; condition?: string }> }) {
  const homeData = backendPublicJson<HomeData>("/v1/views/home", 30).catch(() => null);
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
    description: string | null;
    conditionIds: number[];
    rating: number | null;
    reviewCount: number;
    discountPrice: number | null;
  }> = [];
  let contact = { phone: "", whatsapp: "", supportEmail:"", address:"", openingHours:"", deliveryMessage: "Fast Delivery Across Kenya", facebookUrl: "", instagramUrl: "", xUrl: "", tiktokUrl: "",licenceTitle:"",licenceNumber:"",licenceImageUrl:null as string|null };
  let categoryRows: Array<{ id: number; name: string; slug: string }> = [];
  let conditionRows: Array<{ id: number; name: string; slug: string }> = [];
  let guides: Array<{ id:number; slug:string; title:string; excerpt:string; imageUrl:string|null }> = [];
  let offerTeasers: Array<{ id:number; title:string; description:string|null; total:number; normalTotal:number; isBundle:boolean; itemCount:number; imageUrl:string|null; endsAt:string|null }> = [];
  let promotions: Array<{id:number;title:string;imageUrl:string;productId:number;productName:string}> = [];
  if (data) {
    catalog = data.catalog;
    contact = data.contact;
    categoryRows = data.categories;
    conditionRows = data.conditions;
    guides = data.guides || [];
    offerTeasers = (data.offers || []).map((offer) => ({ id: offer.id, title: offer.title, description: offer.description, total: offer.total, normalTotal: offer.items.reduce((sum, item) => sum + item.normalPrice * item.quantity, 0), isBundle: offer.isBundle, itemCount: offer.items.length, imageUrl: offer.imageUrl, endsAt: offer.endsAt }));
    promotions = data.promotions || [];
  }
  const initialCart = parseCart(jar.get(CART_COOKIE)?.value);
  const initialWishlist = parseWishlist(jar.get(WISHLIST_COOKIE)?.value);
  const offersOnly = params.offers === "1";
  // One seed per request, passed down so the server render and the client hydration
  // arrange the catalogue breaks identically while still differing between visits.
  const layoutSeed = randomInt(0, 2 ** 31);
  const initialCategoryId=categoryRows.find((item)=>item.slug===params.category)?.id??null;
  const initialConditionId=conditionRows.find((item)=>item.slug===params.condition)?.id??null;
  return <Storefront initialProducts={catalog} initialCategories={categoryRows} initialConditions={conditionRows} initialCategoryId={initialCategoryId} initialConditionId={initialConditionId} contact={contact} viewer={session ? { firstName: session.firstName, role: session.role } : null} offersOnly={offersOnly} initialCart={initialCart} initialWishlist={initialWishlist} guides={guides} offers={offerTeasers} promotions={promotions} layoutSeed={layoutSeed} />;
}
