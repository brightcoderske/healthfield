export function apiOrigin() {
  return (process.env.API_PUBLIC_URL || "https://api.healthfieldpharmacy.co.ke").replace(/\/$/, "");
}

export function publicImageUrl(value: string | null | undefined) {
  if (!value || value.startsWith("http://") || value.startsWith("https://")) return value ?? null;
  return `${apiOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
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
