"use client";

import { useEffect, useState } from "react";
import { DELIVERY_PHRASES } from "./delivery-bike";

/**
 * The delivery phrases curved over the floating Healthfield logo, the same way they arch over the
 * banner's bike, taking turns: "We deliver", "Order today", "In 3 hrs", "Countrywide".
 *
 * It appears once the visitor has scrolled past the banner, where the bike rides, so the message stays
 * with them down the page; back at the top the bike has it again and the words fade away. Decorative:
 * the logo button keeps its own label, and taps pass straight through.
 */
export function DeliveryCurve({ id }: { id: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const arc = `delivery-curve-${id}`;
  return (
    <span className={`delivery-curve${visible ? " is-visible" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        {/* The top of a circle around the logo, from the upper left to the upper right. */}
        <path id={arc} d="M15.4 30A40 40 0 0 1 84.6 30" fill="none" />
        {DELIVERY_PHRASES.map((phrase, index) => (
          <text key={phrase} className="delivery-bike-phrase" style={{ animationDelay: `${index * 2.5}s` }}>
            <textPath href={`#${arc}`} startOffset="50%" textAnchor="middle">{phrase}</textPath>
          </text>
        ))}
      </svg>
    </span>
  );
}
