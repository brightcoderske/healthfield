import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, closeDb, databaseClock } from "./db";
import { json } from "./http";
import { handleConsultationAttachment, handleConsultationMessages, handleConsultations } from "./consultations";
import { handleDeliveryBands, handleDeliveryPreview, handleDeliveryQuote, handleDeliverySettings } from "./delivery";
import { handleView } from "./views";
import { mpesaConfiguration } from "./mpesa";
import { finalizeExpiredPaymentCancellations, handleC2bConfirmation, handleC2bVerification, handleIncomingPaymentMatch, handleManualPayment, handlePaymentCancel, handlePaymentReconcile, handlePaymentRetry, handlePaymentReview, handlePaymentStatus, handlePosIncomingPaymentConfirm, handlePullTransactionsNotification, handlePullTransactionsRecovery, handleStkNotification, handleTransactionStatusResult, handleTransactionStatusTimeout, reconcilePendingStkPayments, recoverMissedMpesaPayments } from "./payment-handlers";
import {
  handleAuth, handleBlogs, handleCampaigns, handleChats, handleCustomerOrderReceived, handleInventory, handleOffers, handleOrders, handlePrescriptionCheckout, handlePrescriptionSelection, handlePrescriptions, handlePromotionalBanners, handlePromotionalImage, handleStaffPermissions, handleTaxonomy,
  handleProductImage, handleProducts, handleReviews, handleSettings, handleStaff, handleStores, handleWalkInSales, serveProductImage,
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
function rateLimited(key: string, maximum: number) {
  const now = Date.now(), current = attempts.get(key);
  if (!current || current.reset < now) { attempts.set(key, { count: 1, reset: now + 15 * 60_000 }); return false; }
  current.count += 1;
  return current.count > maximum;
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
  if (url.pathname === "/health") {
    // The clock is reported here because a timezone drift between the host and MySQL
    // is invisible until a receipt shows the wrong time; this makes it checkable the
    // moment a deploy lands.
    const clock = await databaseClock().catch((error) => ({ error: error instanceof Error ? error.message : "Database clock unavailable." }));
    return json({ service: "healthfield-api", status: "ok", timestamp: new Date().toISOString(), clock, deployment: deploymentInfo() });
  }
  const paymentNotificationRoute = url.pathname.match(/^\/v1\/payments\/mobile-money\/(stk\/notification|c2b\/confirmation|c2b\/verification|status\/result|status\/timeout|recovery\/notification)\/([^/]+)$/);
  if (paymentNotificationRoute) {
    const configuredSecret = mpesaConfiguration()?.callbackSecret || "";
    const suppliedSecret = decodeURIComponent(paymentNotificationRoute[2]);
    if (!configuredSecret || !safeEqual(suppliedSecret, configuredSecret)) {
      console.warn("M-Pesa callback rejected before handler", { paymentRoute: paymentNotificationRoute[1], sourceIp: ip, configured: Boolean(configuredSecret) });
      return json({ error: "Payment endpoint not found." }, { status: 404 });
    }
    const paymentRoute = paymentNotificationRoute[1];
    return responseOf(paymentRoute === "stk/notification" ? handleStkNotification(request)
      : paymentRoute === "c2b/verification" ? handleC2bVerification(request)
      : paymentRoute === "c2b/confirmation" ? handleC2bConfirmation(request)
      : paymentRoute === "status/result" ? handleTransactionStatusResult(request)
      : paymentRoute === "status/timeout" ? handleTransactionStatusTimeout(request)
      : handlePullTransactionsNotification(request));
  }
  const imageMatch = url.pathname.match(/^\/uploads\/products\/([^/]+)$/);
  if (imageMatch && request.method === "GET") return serveProductImage(imageMatch[1]);
  const expectedKey = process.env.API_SHARED_SECRET || "";
  const suppliedKey = request.headers.get("x-healthfield-key") || "";
  const directUpload = request.method === "POST" && (url.pathname === "/v1/products/image" || url.pathname === "/v1/promotional-banners/image" || url.pathname === "/v1/prescriptions") && Boolean(origin);
  if (!directUpload && (!expectedKey || !safeEqual(suppliedKey, expectedKey))) return json({ error: "API access denied." }, { status: 401 });
  const trustedClientIp = request.headers.get("x-healthfield-client-ip")?.slice(0, 64) || ip;
  if (url.pathname.startsWith("/v1/auth/") && url.pathname !== "/v1/auth/session") {
    const action = url.pathname.slice("/v1/auth/".length);
    const maximum = action === "login" ? 10 : action === "two-factor" ? 20 : 30;
    if (rateLimited(`${trustedClientIp}:${action}`, maximum)) return json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
  }

  if (url.pathname.startsWith("/v1/views/") && request.method === "GET") return responseOf(handleView(request, url.pathname.slice(10)));
  const authMatch = url.pathname.match(/^\/v1\/auth\/(login|register|forgot-password|reset-password|change-password|verify-email|resend-verification|two-factor|two-factor-resend|session|logout|upload-token)$/);
  if (authMatch) return responseOf(handleAuth(request, authMatch[1]));
  if (url.pathname === "/v1/chats") return responseOf(handleChats(request));
  if (url.pathname === "/v1/orders") return responseOf(handleOrders(request));
  const receivedOrderMatch = url.pathname.match(/^\/v1\/orders\/(\d+)\/received$/);
  if (receivedOrderMatch) return responseOf(handleCustomerOrderReceived(request, Number(receivedOrderMatch[1])));
  const orderMatch = url.pathname.match(/^\/v1\/orders\/(\d+)$/);
  if (orderMatch) return responseOf(handleOrders(request, Number(orderMatch[1])));
  if (url.pathname === "/v1/payments/status") return responseOf(handlePaymentStatus(request));
  if (url.pathname === "/v1/payments/manual") return responseOf(handleManualPayment(request));
  if (url.pathname === "/v1/payments/reconcile") return responseOf(handlePaymentReconcile(request));
  if (url.pathname === "/v1/payments/retry") return responseOf(handlePaymentRetry(request));
  if (url.pathname === "/v1/payments/cancel") return responseOf(handlePaymentCancel(request));
  if (url.pathname === "/v1/payments/mobile-money/recover") return responseOf(handlePullTransactionsRecovery(request));
  const incomingPaymentMatch = url.pathname.match(/^\/v1\/payments\/incoming\/(\d+)\/match$/);
  if (incomingPaymentMatch) return responseOf(handleIncomingPaymentMatch(request, Number(incomingPaymentMatch[1])));
  const posIncomingPaymentConfirmation = url.pathname.match(/^\/v1\/payments\/incoming\/(\d+)\/confirm-pos$/);
  if (posIncomingPaymentConfirmation) return responseOf(handlePosIncomingPaymentConfirm(request, Number(posIncomingPaymentConfirmation[1])));
  const paymentReviewMatch = url.pathname.match(/^\/v1\/payments\/(\d+)\/review$/);
  if (paymentReviewMatch) return responseOf(handlePaymentReview(request, Number(paymentReviewMatch[1])));
  if (url.pathname === "/v1/walk-in-sales") return responseOf(handleWalkInSales(request));
  if (url.pathname === "/v1/offers") return responseOf(handleOffers(request));
  const offerMatch=url.pathname.match(/^\/v1\/offers\/(\d+)$/);if(offerMatch)return responseOf(handleOffers(request,Number(offerMatch[1])));
  if (url.pathname === "/v1/campaigns") return responseOf(handleCampaigns(request));
  if (url.pathname === "/v1/blogs") return responseOf(handleBlogs(request));
  const blogMatch=url.pathname.match(/^\/v1\/blogs\/(\d+)$/);if(blogMatch)return responseOf(handleBlogs(request,Number(blogMatch[1])));
  if (url.pathname === "/v1/promotional-banners") return responseOf(handlePromotionalBanners(request));
  const promotionalBannerMatch=url.pathname.match(/^\/v1\/promotional-banners\/(\d+)$/);if(promotionalBannerMatch)return responseOf(handlePromotionalBanners(request,Number(promotionalBannerMatch[1])));
  if (url.pathname === "/v1/settings") return responseOf(handleSettings(request));
  if (url.pathname === "/v1/promotional-banners/image") return responseOf(handlePromotionalImage(request));
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
  const reviewMatch = url.pathname.match(/^\/v1\/products\/(\d+)\/reviews$/);
  if (reviewMatch) return responseOf(handleReviews(request, Number(reviewMatch[1])));
  if (url.pathname === "/v1/prescriptions") return responseOf(handlePrescriptions(request));
  const prescriptionCheckoutMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)\/checkout$/);
  if (prescriptionCheckoutMatch) return responseOf(handlePrescriptionCheckout(request, Number(prescriptionCheckoutMatch[1])));
  const prescriptionSelectionMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)\/selection$/);
  if (prescriptionSelectionMatch) return responseOf(handlePrescriptionSelection(request, Number(prescriptionSelectionMatch[1])));
  const prescriptionMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)\/download$/);
  if (prescriptionMatch) return responseOf(handlePrescriptions(request, Number(prescriptionMatch[1])));
  const prescriptionStatusMatch = url.pathname.match(/^\/v1\/prescriptions\/(\d+)$/);
  if (prescriptionStatusMatch) return responseOf(handlePrescriptions(request, Number(prescriptionStatusMatch[1])));
  if (url.pathname === "/v1/consultations") {
    // Opening a consultation needs no document, so the queue is protected here
    // rather than relying on upload friction the way prescriptions do.
    if (request.method === "POST" && rateLimited(`${trustedClientIp}:consultation`, 10)) return json({ error: "Too many consultation requests. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
    return responseOf(handleConsultations(request));
  }
  const consultationMessageMatch = url.pathname.match(/^\/v1\/consultations\/(\d+)\/messages$/);
  if (consultationMessageMatch) {
    if (rateLimited(`${trustedClientIp}:consultation-message`, 60)) return json({ error: "Too many messages. Try again shortly." }, { status: 429, headers: { "Retry-After": "900" } });
    return responseOf(handleConsultationMessages(request, Number(consultationMessageMatch[1])));
  }
  const consultationAttachmentMatch = url.pathname.match(/^\/v1\/consultations\/attachments\/(\d+)$/);
  if (consultationAttachmentMatch) return responseOf(handleConsultationAttachment(request, Number(consultationAttachmentMatch[1])));
  const consultationMatch = url.pathname.match(/^\/v1\/consultations\/(\d+)$/);
  if (consultationMatch) return responseOf(handleConsultations(request, Number(consultationMatch[1])));
  const inventoryMatch = url.pathname.match(/^\/v1\/inventory\/(\d+)$/);
  if (inventoryMatch) return responseOf(handleInventory(request, Number(inventoryMatch[1])));
  if (url.pathname === "/v1/staff") return responseOf(handleStaff(request));
  const staffPermissionsMatch = url.pathname.match(/^\/v1\/staff\/(\d+)\/permissions$/);
  if (staffPermissionsMatch) return responseOf(handleStaffPermissions(request, Number(staffPermissionsMatch[1])));
  const staffMatch = url.pathname.match(/^\/v1\/staff\/(\d+)$/);
  if (staffMatch) return responseOf(handleStaff(request, Number(staffMatch[1])));
  if (url.pathname === "/v1/delivery/quote") {
    // Quoting is open to anonymous shoppers and each call can hit Google, so the
    // endpoint is capped per client rather than left as a free metering hole.
    if (rateLimited(`${trustedClientIp}:delivery-quote`, 120)) return json({ error: "Too many delivery quotes. Try again shortly." }, { status: 429, headers: { "Retry-After": "900" } });
    return responseOf(handleDeliveryQuote(request));
  }
  if (url.pathname === "/v1/delivery/preview") return responseOf(handleDeliveryPreview(request));
  if (url.pathname === "/v1/delivery/settings") return responseOf(handleDeliverySettings(request));
  if (url.pathname === "/v1/delivery/bands") return responseOf(handleDeliveryBands(request));
  const deliveryBandMatch = url.pathname.match(/^\/v1\/delivery\/bands\/(\d+)$/);
  if (deliveryBandMatch) return responseOf(handleDeliveryBands(request, Number(deliveryBandMatch[1])));
  if (url.pathname === "/v1/stores") return responseOf(handleStores(request));
  const storeMatch = url.pathname.match(/^\/v1\/stores\/(\d+)$/);
  if (storeMatch) return responseOf(handleStores(request, Number(storeMatch[1])));
  return json({ error: "Route not found." }, { status: 404 });
}

function webRequest(request: ExpressRequest) {
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers.host || "api.healthfieldpharmacy.co.ke";
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers as HeadersInit };
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) { init.body = Readable.toWeb(request) as ReadableStream; init.duplex = "half"; }
  return new Request(`${protocol}://${host}${request.url || "/"}`, init);
}

async function send(nodeResponse: ExpressResponse, response: Response) {
  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) return nodeResponse.end();
  Readable.fromWeb(response.body as never).pipe(nodeResponse);
}

const app = express();
app.disable("x-powered-by");
app.all("/{*path}", async (nodeRequest, nodeResponse) => {
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
const server = app.listen(port, "0.0.0.0", () => console.log(`Healthfield API listening on ${port}`));
const paymentMaintenance = setInterval(() => void finalizeExpiredPaymentCancellations().catch((error) => console.error("Payment cancellation maintenance failed", error)), 30_000);
paymentMaintenance.unref();
const initialStkReconciliation = setTimeout(() => void reconcilePendingStkPayments().catch((error) => console.error("Initial STK reconciliation failed", error)), 15_000);
initialStkReconciliation.unref();
const stkReconciliation = setInterval(() => void reconcilePendingStkPayments().catch((error) => console.error("Scheduled STK reconciliation failed", error)), 30_000);
stkReconciliation.unref();
const initialPaymentRecovery = setTimeout(() => void recoverMissedMpesaPayments(null, 2).catch((error) => console.error("Initial M-Pesa Pull recovery failed", error)), 60_000);
initialPaymentRecovery.unref();
const paymentRecovery = setInterval(() => void recoverMissedMpesaPayments(null, 2).catch((error) => console.error("Scheduled M-Pesa Pull recovery failed", error)), 15 * 60_000);
paymentRecovery.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(paymentMaintenance);
  clearTimeout(initialStkReconciliation);
  clearInterval(stkReconciliation);
  clearTimeout(initialPaymentRecovery);
  clearInterval(paymentRecovery);
  console.log(`Healthfield API received ${signal}; closing server and database pool.`);
  const forceExit = setTimeout(() => process.exit(0), 5_000);
  forceExit.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT", "SIGUSR2"] as const) process.once(signal, () => void shutdown(signal));
