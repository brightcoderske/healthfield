/** What the bike and the floating logo say, in turn. */
export const DELIVERY_PHRASES = ["We deliver", "Order today", "In 3 hrs", "Countrywide"] as const;

/**
 * A small delivery motorbike in the shop's colours that rides back and forth with words arched over it
 * that take turns: "We deliver", "Order today", "In 3 hrs", "Countrywide".
 *
 * Pure SVG and CSS (app/delivery-bike.css): nothing to download and no script running. The bike turns
 * round at each end so it always faces the way it is going; the words ride above it and never turn, so
 * they always read the right way. Anyone who has asked their device for less motion gets it parked.
 *
 *  - variant "hero": floats along the bottom of the desktop banner, beside the trust badges.
 *  - variant "banner": floats along the bottom of the phone banner, behind its words and button (so they
 *    stay readable and tappable) and in front of the picture. It takes no space of its own.
 *
 * `id` keeps the curved text's path unique when both are on the page.
 */
export function DeliveryBike({ id, variant }: { id: string; variant: "hero" | "banner" }) {
  const arc = `delivery-bike-arc-${id}`;
  return (
    <div className={`delivery-bike-lane delivery-bike-${variant}`} role="img" aria-label={DELIVERY_PHRASES.join(". ")}>
      <div className="delivery-bike-rider">
        <svg className="delivery-bike-words" viewBox="0 0 128 34" aria-hidden="true">
          <path id={arc} d="M14 31 Q64 -1 114 31" fill="none" />
          {DELIVERY_PHRASES.map((phrase, index) => (
            <text key={phrase} className="delivery-bike-phrase" style={{ animationDelay: `${index * 2.5}s` }}>
              <textPath href={`#${arc}`} startOffset="50%" textAnchor="middle">{phrase}</textPath>
            </text>
          ))}
        </svg>
        <div className="delivery-bike-face">
          <svg className="delivery-bike-svg" viewBox="-16 0 136 64" aria-hidden="true">
            {/* Speed lines, behind the bike whichever way it faces. */}
            <g className="delivery-bike-speed" stroke="#e33176" strokeWidth="2.5" strokeLinecap="round">
              <path d="M-14 20H-4" />
              <path d="M-11 29H-2" />
              <path d="M-14 38H-6" />
            </g>
            {/* The delivery box, with a pharmacy cross, on its rack. */}
            <rect x="6" y="10" width="34" height="27" rx="5" fill="#70227e" />
            <rect x="6" y="10" width="34" height="7" rx="4" fill="#5a1a66" />
            <rect x="21" y="20" width="4" height="12" rx="1" fill="#fff" />
            <rect x="17" y="24" width="12" height="4" rx="1" fill="#fff" />
            <path d="M8 39H42" stroke="#2a1730" strokeWidth="3" strokeLinecap="round" />
            {/* Body, seat, stem and handlebar. */}
            <path d="M24 47Q26 37 40 37H60Q66 37 70 31L77 19L83 21L76 37Q72 47 62 49H30Q24 49 24 47Z" fill="#e33176" />
            <rect x="34" y="30" width="24" height="7" rx="3.5" fill="#2a1730" />
            <path d="M80 20L94 52" stroke="#2a1730" strokeWidth="4" strokeLinecap="round" />
            <path d="M73 15H87" stroke="#2a1730" strokeWidth="4" strokeLinecap="round" />
            <path d="M82 46Q94 38 106 46" fill="none" stroke="#e33176" strokeWidth="4" strokeLinecap="round" />
            <circle cx="87" cy="27" r="3.5" fill="#ffd166" />
            {/* Wheels: the light marks on each tyre are what make the spin visible. */}
            <g className="delivery-bike-wheel">
              <circle cx="30" cy="52" r="11" fill="#2a1730" />
              <path d="M30 42.5V61.5M20.5 52H39.5" stroke="#c9b8cf" strokeWidth="1.6" />
              <circle cx="30" cy="52" r="5" fill="#fff" />
              <circle cx="30" cy="52" r="2" fill="#70227e" />
            </g>
            <g className="delivery-bike-wheel">
              <circle cx="94" cy="52" r="11" fill="#2a1730" />
              <path d="M94 42.5V61.5M84.5 52H103.5" stroke="#c9b8cf" strokeWidth="1.6" />
              <circle cx="94" cy="52" r="5" fill="#fff" />
              <circle cx="94" cy="52" r="2" fill="#70227e" />
            </g>
          </svg>
        </div>
        <span className="delivery-bike-shadow" aria-hidden="true" />
      </div>
    </div>
  );
}
