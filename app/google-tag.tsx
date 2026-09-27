"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * gtag's own 'config' call only reports the page it was loaded on. The App Router
 * never reloads the page on navigation, so every route change after that has to be
 * reported by hand or Google Ads undercounts traffic and remarketing audience size.
 */
function RouteChangeTracker({ adsId }: { adsId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (typeof window.gtag !== "function") return;
    const query = searchParams.toString();
    window.gtag("event", "page_view", {
      send_to: adsId,
      page_path: query ? `${pathname}?${query}` : pathname,
    });
  }, [pathname, searchParams, adsId]);

  return null;
}

/** The account's own base tag (gtag.js), verbatim — just split across next/script tags. */
export function GoogleTag({ adsId }: { adsId: string }) {
  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${adsId}`}
        strategy="afterInteractive"
      />
      <Script id="google-tag-base" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${adsId}');
        `}
      </Script>
      <Suspense fallback={null}>
        <RouteChangeTracker adsId={adsId} />
      </Suspense>
    </>
  );
}
