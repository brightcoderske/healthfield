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

// LOW_RESOURCE_BUILD=1 (set by scripts/deploy.sh) is for building on the shared cPanel account,
// which refuses to start more processes than its limit (spawn EAGAIN). It keeps the webpack build
// in the main process instead of a separate worker, runs the page-generation workers as threads
// instead of child processes, and skips Next's own type check. Vercel and CI do not set it and build as before.
const lowResourceBuild = process.env.LOW_RESOURCE_BUILD === "1";

const nextConfig: NextConfig = {
  // The type check holds the whole program in memory next to the webpack build, which together
  // pass the account's 2 GB when the build runs in one process. It is skipped only in that mode;
  // types are checked with `tsc --noEmit` before pushing.
  ...(lowResourceBuild ? { typescript: { ignoreBuildErrors: true } } : {}),
  experimental: {
    ...(lowResourceBuild ? { webpackBuildWorker: false, workerThreads: true } : {}),
    cpus: 1,
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1000,
  },
  allowedDevOrigins: ["192.168.100.3"],
  poweredByHeader: false,
  compress: true,
  images: {
    // Product media is optimized when it is uploaded to the API/storage host. The API
    // host's firewall blocks ordinary browsers, so app/uploads/products passes each file
    // through once and the CDN caches it. Nothing is resized or re-encoded through
    // /_next/image.
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
