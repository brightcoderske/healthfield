/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Package, Tag } from "lucide-react";
import { OfferShareButton } from "./offer-share-button";
import type { Offer } from "./offer-data";
import { PrescriptionAddButton } from "@/app/prescription-add-button";

const money = (value: number) =>
  `KES ${Math.round(value).toLocaleString("en-KE")}`;

export function OfferCard({
  offer,
  showArtwork = false,
}: {
  offer: Offer;
  showArtwork?: boolean;
}) {
  const normal = offer.items.reduce(
    (sum, item) => sum + item.normalPrice * item.quantity,
    0,
  );
  const saving = normal > offer.total ? normal - offer.total : 0;
  const prescriptionItems = offer.items
    .filter((item) => item.prescriptionRequired)
    .map((item) => ({
      id: item.productId,
      name: item.name,
      quantity: item.quantity,
    }));
  return (
    <article
      className={showArtwork ? "offer-card shared-offer-card" : "offer-card"}
      id={`offer-${offer.id}`}
    >
      {showArtwork && offer.imageUrl ? (
        <div className="shared-offer-artwork">
          <img src={offer.imageUrl} alt={`${offer.title} offer`} />
        </div>
      ) : null}
      <header>
        <span className="offer-card-flag">
          <Tag /> {offer.isBundle ? "Collection" : "Offer"}
        </span>
        <span className="offer-card-header-actions">
          {offer.endsAt && (
            <small>
              Ends {new Date(offer.endsAt).toLocaleDateString("en-KE")}
            </small>
          )}
          <OfferShareButton slug={offer.slug} title={offer.title} />
        </span>
      </header>
      <h2>{offer.title}</h2>
      {offer.description && <p>{offer.description}</p>}
      <ul className="offer-card-items">
        {offer.items.map((item) => (
          <li key={item.productId}>
            <Link prefetch={false} href={`/products/${item.productId}`}>
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span>
                  <Package />
                </span>
              )}
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {offer.isBundle ? (
                    money(item.normalPrice)
                  ) : (
                    <>
                      {money(item.offerPrice ?? item.normalPrice)}{" "}
                      <del>{money(item.normalPrice)}</del>
                    </>
                  )}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <footer>
        <div className="offer-card-price">
          <b>{money(offer.total)}</b>
          {saving > 0 && (
            <>
              <del>{money(normal)}</del>
              <em>Save {money(saving)}</em>
            </>
          )}
        </div>
        {prescriptionItems.length ? (
          <PrescriptionAddButton items={prescriptionItems}>
            {offer.isBundle ? "Add bundle to cart" : "Add to cart"}
          </PrescriptionAddButton>
        ) : (
          <form action="/api/cart" method="post">
            {offer.isBundle ? (
              <input type="hidden" name="offerId" value={offer.id} />
            ) : (
              <input
                type="hidden"
                name="productId"
                value={offer.items[0]?.productId}
              />
            )}
            <input type="hidden" name="action" value="add" />
            <input type="hidden" name="return" value="/cart" />
            <button type="submit">
              {offer.isBundle ? "Add bundle to cart" : "Add to cart"}
            </button>
          </form>
        )}
      </footer>
      {showArtwork ? (
        <div className="shared-offer-share">
          <OfferShareButton slug={offer.slug} title={offer.title} labelled />
        </div>
      ) : null}
    </article>
  );
}
