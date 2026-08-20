import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The POS and the product manager scan barcodes with the device camera, so it is allowed for
  // this origin only — never for embedded third parties. Microphone stays fully disabled.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1000,
  },
  allowedDevOrigins: ["192.168.100.3"],
  poweredByHeader: false,
  compress: true,
  images: {
    // Product media is optimized and served by the API/storage host. Keep the
    // storefront out of the image-delivery path so Vercel never proxies or
    // transforms those files through /_next/image.
    unoptimized: true,
  },
  async redirects() {
    // Order SMS is billed per character, so the message points at the shortest link that
    // can carry the meaning. There is no /orders page — the customer's orders are the
    // first section of the account page — and every message sent so far has pointed at a
    // 404. Redirecting keeps the short link in the SMS and heals the ones already sent.
    return [
      { source: "/orders", destination: "/account#orders", permanent: false },
      { source: "/account/orders", destination: "/account#orders", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/prescriptions/:id/download",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
