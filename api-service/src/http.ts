export function apiOrigin() {
  return (process.env.API_PUBLIC_URL || "https://api.healthfieldpharmacy.co.ke").replace(/\/$/, "");
}

const storefrontHosts = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || "https://healthfieldpharmacy.co.ke,https://www.healthfieldpharmacy.co.ke")
    .split(",")
    .map((value) => {
      try { return new URL(value.trim()).host; } catch { return ""; }
    })
    .filter(Boolean),
);

// Where browsers load product images from. The API host's firewall challenges ordinary
// visitors, so images are linked through the storefront, which fetches them from here
// server-side (app/uploads/products/[filename]/route.ts) and caches them on its CDN.
function imageOrigin() {
  // The www host, because the bare domain answers every request with a redirect to it.
  return (process.env.IMAGE_PUBLIC_URL || "https://www.healthfieldpharmacy.co.ke").replace(/\/$/, "");
}

export function publicImageUrl(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      // Older rows hold absolute links on either host; both now point through the storefront.
      const ownHost = storefrontHosts.has(url.host) || url.host === new URL(apiOrigin()).host;
      if (ownHost && url.pathname.startsWith("/uploads/products/")) {
        return `${imageOrigin()}${url.pathname}`;
      }
    } catch { /* keep original */ }
    return value;
  }
  const pathname = value.startsWith("/") ? value : `/${value}`;
  return `${pathname.startsWith("/uploads/products/") ? imageOrigin() : apiOrigin()}${pathname}`;
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", headers.get("Cache-Control") || "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function input(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json().catch(() => null);
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    return Object.fromEntries(await request.formData());
  }
  return null;
}

export function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255);
}
