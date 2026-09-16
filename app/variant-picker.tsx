"use client";

import { Package, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { defaultVariant, variantDisplayName } from "@/lib/product-variants";
import { QuantityField } from "./quantity-field";
import type { ProductCardProduct } from "./product-card";

const money = (value: number) => `KES ${Math.round(value).toLocaleString("en-KE")}`;

type PickerProps = {
  productName: string;
  optionName: string;
  variants: ProductCardProduct[];
  onClose: () => void;
  onAdd: (variant: ProductCardProduct, quantity: number) => void;
  busy?: boolean;
  error?: string;
  /** The option to open on — the one whose page the shopper is looking at. */
  initialVariantId?: number;
};

/** Mounts only while it is open, so every opening starts at one of the default option. */
export function VariantPicker({ open, ...props }: PickerProps & { open: boolean }) {
  return open ? <VariantPickerPanel {...props} /> : null;
}

/**
 * Choosing which option to buy, and how many, before it goes in the basket.
 *
 * A product that comes in three colours cannot be added without saying which one, and a
 * grid card is too small to ask properly — so the press on Add opens this, the options
 * laid out with their prices and a quantity under them. Picking one and pressing Add is
 * two taps, and buying a second colour is opening it again.
 */
function VariantPickerPanel({
  productName,
  optionName,
  variants,
  onClose,
  onAdd,
  busy = false,
  error = "",
  initialVariantId,
}: PickerProps) {
  const [chosenId, setChosenId] = useState(() =>
    variants.some((variant) => variant.id === initialVariantId)
      ? (initialVariantId as number)
      : defaultVariant(variants).id,
  );
  const [quantity, setQuantity] = useState(1);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    // Focus lands inside the sheet so a keyboard is not left behind on the page under it.
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const chosen = variants.find((variant) => variant.id === chosenId) ?? variants[0];
  const price = Number(chosen.discountPrice ?? chosen.price);
  const regular = Number(chosen.price);

  // Rendered onto the body rather than inside the card that opened it. A card ancestor
  // carries a CSS filter for its drop shadow, and a filter makes that ancestor the
  // containing block for anything positioned fixed inside it — so the sheet was being
  // laid out and clipped inside a 172px tile instead of covering the screen.
  return createPortal(
    <div className="variant-picker-backdrop" onClick={onClose} role="presentation">
      <div
        className="variant-picker"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Choose ${optionName.toLowerCase()} for ${productName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{productName}</strong>
            <small>Choose {optionName.toLowerCase()}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>

        <div className="variant-picker-options" role="radiogroup" aria-label={optionName}>
          {variants.map((variant) => {
            const chosenOne = variant.id === chosen.id;
            const variantPrice = Number(variant.discountPrice ?? variant.price);
            return (
              <button
                type="button"
                key={variant.id}
                role="radio"
                aria-checked={chosenOne}
                className={chosenOne ? "is-chosen" : ""}
                onClick={() => setChosenId(variant.id)}
              >
                <span className="variant-picker-thumb">
                  {variant.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={variant.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Package />
                  )}
                </span>
                <span className="variant-picker-label">
                  <b>{variant.variantLabel || "Standard"}</b>
                  <small>{money(variantPrice)}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="variant-picker-quantity">
          <span>How many?</span>
          <QuantityField
            value={quantity}
            onChange={setQuantity}
            disabled={busy}
            label={`Quantity of ${variantDisplayName(productName, chosen.variantLabel)}`}
          />
        </div>

        {error ? <p className="variant-picker-error" role="alert">{error}</p> : null}

        <footer>
          <span className="variant-picker-total">
            {money(price * quantity)}
            {regular > price ? <del>{money(regular * quantity)}</del> : null}
          </span>
          <button
            type="button"
            className="variant-picker-add"
            disabled={busy}
            onClick={() => onAdd(chosen, quantity)}
          >
            {busy ? "Adding…" : `Add ${quantity > 1 ? `${quantity} · ` : ""}${chosen.variantLabel || ""}`.trim()}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
