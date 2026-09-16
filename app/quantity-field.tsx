"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

/**
 * A quantity control whose number can simply be typed into.
 *
 * The buttons are for nudging one at a time; anybody who wants twelve of something
 * should be able to type twelve rather than press a button twelve times. The field holds
 * what was typed as text while it is being typed — clearing it to type a new number must
 * not snap back to 1 on the first keystroke — and commits a clamped number on blur.
 */
export function QuantityField({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled = false,
  label,
  className = "quantity-field",
}: {
  value: number;
  onChange: (quantity: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [typed, setTyped] = useState(String(value));
  // When the quantity changes for some other reason — a button press, a saved basket
  // coming back, a different option chosen — the box follows it. Adjusted during render
  // against the last value seen rather than in an effect, so there is no extra pass
  // where the box and the real quantity disagree.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setTyped(String(value));
  }

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const next =
      !raw.trim() || !Number.isFinite(parsed)
        ? value
        : Math.min(max, Math.max(min, Math.round(parsed)));
    setTyped(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Minus />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={typed}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^0-9]/g, "");
          setTyped(raw);
          // Commit as it is typed when it is already a usable number, so the price beside
          // it keeps up; an emptied box waits for blur rather than jumping to the minimum.
          if (raw) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
          }
        }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const field = event.target as HTMLInputElement;
            commit(field.value);
            field.blur();
          }
        }}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        <Plus />
      </button>
    </div>
  );
}
