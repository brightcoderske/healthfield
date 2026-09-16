"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Package } from "lucide-react";
import { useState } from "react";
import type { OfferItem } from "./offer-data";

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

/** Beyond this many products a collection shows the first few and offers the rest. */
const COLLAPSE_ABOVE = 5;
const SHOWN_WHEN_COLLAPSED = 4;

/**
 * The products inside an offer.
 *
 * A collection of six listed in full made one card far longer than the cards beside it,
 * and on a phone pushed its price and Add button a long scroll away. Past five products
 * the first four are shown with a button for the rest, so every card keeps a comparable
 * height and the total and Add button stay close at hand.
 *
 * A picture that fails to load falls back to the same placeholder the product cards use,
 * rather than the browser's broken-image symbol.
 */
export function OfferItems({ items, isBundle }: { items: OfferItem[]; isBundle: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState<number[]>([]);
  const collapsible = items.length > COLLAPSE_ABOVE;
  const visible = collapsible && !expanded ? items.slice(0, SHOWN_WHEN_COLLAPSED) : items;
  const hidden = items.length - visible.length;

  return (
    <>
      <ul className="offer-card-items">
        {visible.map((item) => (
          <li key={item.productId}>
            <Link prefetch={false} href={`/products/${item.productId}`}>
              {item.imageUrl && !failed.includes(item.productId) ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailed((current) => [...current, item.productId])}
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
                  {isBundle ? (
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
      {collapsible ? (
        <button
          type="button"
          className="offer-card-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show fewer products" : `Show ${hidden} more product${hidden === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </>
  );
}
