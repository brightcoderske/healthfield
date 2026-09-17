"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

/**
 * The picture at the top of an offer's own page.
 *
 * If the picture cannot be loaded, the panel is left out entirely. Otherwise the page
 * opened on a large empty panel with the offer's name printed in it as broken-image text,
 * which read as the page itself being broken.
 */
export function OfferArtwork({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="shared-offer-artwork">
      <img
        src={src}
        alt={`${title} offer`}
        onError={() => setFailed(true)}
        // The picture is in the page's HTML, so it can fail before this component is
        // listening. On arrival, one that has already finished with nothing to show counts
        // as failed too.
        ref={(image) => {
          if (image && image.complete && image.naturalWidth === 0) setFailed(true);
        }}
      />
    </div>
  );
}
