import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, closeDb } from "./db";
import { json } from "./http";
import { handleView } from "./views";
import {
  handleAuth, handleCampaigns, handleChats, handleInventory, handleOrders, handlePrescriptions, handleTaxonomy,
  handleProductImage, handleProducts, handleSettings, handleStaff, handleStores, handleWalkInSales, serveProductImage,
} from "./mutations";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnvFile(envPath);

const allowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS || "https://healthfieldpharmacy.co.ke,https://www.healthfieldpharmacy.co.ke")
  .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean));

function deploymentInfo() {
  try {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), ".healthfield-build.json"), "utf8"));
    return { commit: String(parsed.commit || "unknown"), builtAt: String(parsed.builtAt || "unknown") };
  } catch { return { commit: "unknown", builtAt: "unknown" }; }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function securityHeaders(response: Response, origin: string | null) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const attempts = new Map<string, { count: number; reset: number }>();
function rateLimited(ip: string) {
  const now = Date.now(), current = attempts.get(ip);
  if (!current || current.reset < now) { attempts.set(ip, { count: 1, reset: now + 15 * 60_000 }); return false; }
  current.count += 1;
  return current.count > 30;
}

async function responseOf(value: Promise<Response | undefined>) {
  return (await value) ?? json({ error: "API handler returned no response." }, { status: 500 });
}

async function route(request: Request, ip: string): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin")?.replace(/\/$/, "") || null;
  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed." }, { status: 403 });
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Healthfield-Key", "Access-Control-Max-Age": "86400" } });
  }
  // Browser navigations and <img> tags often omit Origin; only enforce CORS for credentialed cross-origin API calls.
  if (origin && !allowedOrigins.has(origin) && url.pathname.startsWith("/v1/")) return json({ error: "Origin not allowed." }, { status: 403 });
  if (url.pathname === "/health") return json({ service: "healthfield-api", status: "ok", timestamp: new Date().toISOString(), deployment: deploymentInfo() });
  const imageMatch = url.pathname.match(/^\/uploads\/products\/([^/]+)$/);
  if (imageMatch && request.method === "GET") return serveProductImage(imageMatch[1]);
  const expectedKey = process.env.API_SHARED_SECRET || "";
  const suppliedKey = request.headers.get("x-healthfield-key") || "";
  const directUpload = request.method === "POST" && (url.pathname === "/v1/products/image" || url.pathname === "/v1/prescriptions") && Boolean(origin);
  if (!directUpload && (!expectedKey || !safeEqual(suppliedKey, expectedKey))) return json({ error: "API access denied." }, { status: 401 });
  if (url.pathname.startsWith("/v1/auth/") && rateLimited(ip)) return json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });

  if (url.pathname.startsWith("/v1/views/") && request.method === "GET") return responseOf(handleView(request, url.pathname.slice(10)));
  const authMatch = url.pathname.match(/^\/v1\/auth\/(login|register|forgot-password|reset-password|change-password)$/);
  if (authMatch) return responseOf(handleAuth(request, authMatch[1]));
  if (url.pathname === "/v1/chats") return responseOf(handleChats(request));
  if (url.pathname === "/v1/orders") return responseOf(handleOrders(request));
  const orderMatch = url.pathname.match(/^\/v1\/orders\/(\d+)$/);
  if (orderMatch) return responseOf(handleOrders(request, Number(orderMatch[1])));
  if (url.pathname === "/v1/walk-in-sales") return responseOf(handleWalkInSales(request));
  if (url.pathname === "/v1/campaigns") return responseOf(handleCampaigns(request));
  if (url.pathname === "/v1/settings") return responseOf(handleSettings(request));
  if (url.pathname === "/v1/products/image") return responseOf(handleProductImage(request));
  if (url.pathname === "/v1/products") return responseOf(handleProducts(request));
  if (url.pathname === "/v1/categories") return responseOf(handleTaxonomy(request, "categories"));
  if (url.pathname === "/v1/conditions") return responseOf(handleTaxonomy(request, "conditions"));
  const categoryMatch = url.pathname.match(/^\/v1\/categories\/(\d+)$/);
  if (categoryMatch) return responseOf(handleTaxonomy(request, "categories", Number(categoryMatch[1])));
  const conditionMatch = url.pathname.match(/^\/v1\/conditions\/(\d+)$/);
  if (conditionMatch) return responseOf(handleTaxonomy(request, "conditions", Number(conditionMatch[1])));
  const productMatch = url.pathname.match(/^\/v1\/products\/(\d+)$/);
  if (productMatch) return responseOf(handleProducts(request, Number(productMatch[1])));
  if (url.pathname === "/v1/prescriptions") return responseOf(handlePrescriptions(request));
  const prescriptionMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)\/download$/);
  if (prescriptionMatch) return responseOf(handlePrescriptions(request, Number(prescriptionMatch[1])));
  const prescriptionStatusMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)$/);
  if (prescriptionStatusMatch) return responseOf(handlePrescriptions(request, Number(prescriptionStatusMatch[1])));
  const inventoryMatch = url.pathname.match(/^\/v1\/inventory\/(\d+)$/);
  if (inventoryMatch) return responseOf(handleInventory(request, Number(inventoryMatch[1])));
  if (url.pathname === "/v1/staff") return responseOf(handleStaff(request));
  const staffMatch = url.pathname.match(/^\/v1\/staff\/(\d+)$/);
  if (staffMatch) return responseOf(handleStaff(request, Number(staffMatch[1])));
  if (url.pathname === "/v1/stores") return responseOf(handleStores(request));
  const storeMatch = url.pathname.match(/^\/v1\/stores\/(\d+)$/);
  if (storeMatch) return responseOf(handleStores(request, Number(storeMatch[1])));
  return json({ error: "Route not found." }, { status: 404 });
}

function webRequest(request: IncomingMessage) {
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers.host || "api.healthfieldpharmacy.co.ke";
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers as HeadersInit };
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) { init.body = Readable.toWeb(request) as ReadableStream; init.duplex = "half"; }
  return new Request(`${protocol}://${host}${request.url || "/"}`, init);
}

async function send(nodeResponse: ServerResponse, response: Response) {
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) return nodeResponse.end();
  Readable.fromWeb(response.body as never).pipe(nodeResponse);
}

const server = createServer(async (nodeRequest, nodeResponse) => {
  const origin = typeof nodeRequest.headers.origin === "string" ? nodeRequest.headers.origin.replace(/\/$/, "") : null;
  try {
    const length = Number(nodeRequest.headers["content-length"] || 0);
    if (length > 12 * 1024 * 1024) return send(nodeResponse, securityHeaders(json({ error: "Request is too large." }, { status: 413 }), origin));
    const ip = String(nodeRequest.headers["x-forwarded-for"] || nodeRequest.socket.remoteAddress || "unknown").split(",")[0].trim();
    await send(nodeResponse, securityHeaders(await route(webRequest(nodeRequest), ip), origin));
  } catch (error) {
    const reference = Math.random().toString(36).slice(2, 10);
    console.error(`[${reference}]`, error);
    await send(nodeResponse, securityHeaders(json({ error: "The API could not complete this request.", reference }, { status: 500 }), origin));
  }
});

const port = Number(process.env.PORT || 3001);
if (process.env.RUN_MIGRATIONS !== "false") await migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "drizzle") });
server.listen(port, "0.0.0.0", () => console.log(`Healthfield API listening on ${port}`));

async function shutdown() { server.close(); await closeDb(); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
