import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { offerItems, offers, products } from "../../db/schema";
import { getDb } from "./db";
import { isLive, type ResolvedOffer } from "./offer-pricing";

export { apportionBundle, normalTotal, offerTotal, isBundle, offerPriceMap, isLive } from "./offer-pricing";
export type { ResolvedOffer, ResolvedOfferItem } from "./offer-pricing";

/**
 * Offers currently on sale, with their products resolved.
 *
 * Liveness is evaluated on every read rather than written onto products, so an
 * expiry needs no scheduled job: the moment a window closes, the normal price is
 * what the storefront and the order endpoint both see.
 */
export async function loadLiveOffers(now = new Date()): Promise<ResolvedOffer[]> {
  const db = getDb();
  const rows = await db.select().from(offers)
    .where(and(eq(offers.isActive, true), or(isNull(offers.endsAt), gt(offers.endsAt, now))))
    .orderBy(asc(offers.displayOrder), asc(offers.id));
  const live = rows.filter((offer) => isLive(offer, now));
  if (!live.length) return [];

  const members = await db.select({
    offerId: offerItems.offerId, productId: offerItems.productId, quantity: offerItems.quantity,
    offerPrice: offerItems.offerPrice, name: products.name, imageUrl: products.imageUrl,
    price: products.price, discountPrice: products.discountPrice, prescriptionRequired: products.prescriptionRequired, isActive: products.isActive,
  }).from(offerItems).innerJoin(products, eq(products.id, offerItems.productId))
    .orderBy(asc(offerItems.displayOrder), asc(offerItems.id));

  return live.map((offer) => ({
    id: offer.id,
    title: offer.title,
    slug: offer.slug,
    description: offer.description,
    imageUrl: offer.imageUrl,
    endsAt: offer.endsAt ? offer.endsAt.toISOString() : null,
    bundlePrice: offer.bundlePrice === null ? null : Number(offer.bundlePrice),
    items: members.filter((member) => member.offerId === offer.id && member.isActive).map((member) => ({
      productId: member.productId,
      name: member.name,
      imageUrl: member.imageUrl,
      quantity: member.quantity,
      normalPrice: Number(member.discountPrice ?? member.price),
      offerPrice: member.offerPrice === null ? null : Number(member.offerPrice),
      prescriptionRequired: member.prescriptionRequired,
    })),
    // An offer whose products were all de-listed is dropped rather than shown empty.
  })).filter((offer) => offer.items.length > 0);
}
