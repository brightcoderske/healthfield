import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, closeDb, databaseClock } from "./db";
import { json } from "./http";
import { handleConsultationAttachment, handleConsultationMessages, handleConsultations } from "./consultations";
import { handleSmsReportRefresh } from "./sms-routes";
import { handleDeliveryBands, handleDeliveryPreview, handleDeliveryQuote, handleDeliverySettings } from "./delivery";
import { handleView } from "./views";
import { changesCatalogue, changesCounts, changesSessions, serveCachedView } from "./catalogue-cache";
import { outboxStatus, startOutbox } from "./outbox-delivery";
import { closeSharedCache, getSharedCache } from "./redis";
import { mpesaConfiguration, setMpesaTokenStore } from "./mpesa";
import { handleDailyReportSend, runDailyReportIfDue } from "./daily-report";
import { handlePosExpenses, handlePosHeldSales, handlePosReports, handlePosSessions, handlePosStockReceipts, posWorkspaceState } from "./pos";
import { handleVatRemittances } from "./vat";
import { handlePosSale } from "./pos-sale";
import { finalizeExpiredPaymentCancellations, handleC2bConfirmation, handleC2bRegistration, handleC2bVerification, handleIncomingPaymentMatch, handleIncomingPaymentsDelete, handleManualPayment, handlePaymentCancel, handlePaymentReconcile, handlePaymentRetry, handlePaymentReview, handlePaymentStatus, handlePosIncomingPaymentConfirm, handlePullTransactionsNotification, handlePullTransactionsRecovery, handleStkNotification, handleTransactionStatusResult, handleTransactionStatusTimeout, reconcilePendingStkPayments, recoverMissedMpesaPayments } from "./payment-handlers";
import {
  handleAuth, handleBlogs, handleCampaigns, handleChats, handleCustomerOrderReceived, handleInventory, handleOffers, handleOrders, handlePrescriptionCheckout, handlePrescriptionSelection, handlePrescriptions, handlePromotionalBanners, handlePromotionalImage, handleStaffPermissions, handleTaxonomy,
  handleProductImage, handleProducts, handleProductsBulk, handleProductVariants, handleReviews, handleSettings, handleStaff, handleStores, handleWalkInSales, serveProductImage,
} from "./mutations";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnvFile(envPath);

// Opened here, once the settings are loaded, so the connection is warm before the first
// request (and does nothing at all if Redis has not been configured). M-Pesa's access token
// is kept in it so workers share one instead of each asking Safaricom for their own.
const startupCache = getSharedCache();
// The worker that sends queued emails and SMS; does nothing at all without Redis.
startOutbox();
setMpesaTokenStore({
  get: (key) => startupCache.get(key),
  set: (key, value, ttlSeconds) => startupCache.set(key, value, ttlSeconds),
});

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

// Counted in Redis when it is available, so a limit holds across restarts and across every
// worker; in this process's memory, as it always was, when it is not. Either way a window
// is fifteen minutes.
function rateLimited(key: string, maximum: number) {
  return getSharedCache().rateLimited(key, maximum, 15 * 60);
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
    const cache = getSharedCache();
    return json({ service: "healthfield-api", status: "ok", timestamp: new Date().toISOString(), clock, deployment: deploymentInfo(), cache: { status: cache.status, ...cache.counters }, outbox: await outboxStatus() });
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
    const handle = () => responseOf(paymentRoute === "stk/notification" ? handleStkNotification(request)
      : paymentRoute === "c2b/verification" ? handleC2bVerification(request)
      : paymentRoute === "c2b/confirmation" ? handleC2bConfirmation(request)
      : paymentRoute === "status/result" ? handleTransactionStatusResult(request)
      : paymentRoute === "status/timeout" ? handleTransactionStatusTimeout(request)
      : handlePullTransactionsNotification(request));
    // Safaricom sends a callback again if it does not hear back quickly, so the same one can
    // arrive twice at once. The database already makes handling it twice harmless; this makes
    // the copies wait their turn, so the second finds the work done instead of racing the
    // first. It only ever orders them: if the lock cannot be had, the handler runs regardless.
    // Only after the secret above has been checked, so nobody unauthenticated can hold a lock.
    const body = request.method === "POST" ? await request.clone().text().catch(() => "") : "";
    if (!body || body.length > 64_000) return handle();
    const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
    return getSharedCache().withLock(`mpesa:${paymentRoute}:${digest}`, 30_000, handle);
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
    if (await rateLimited(`${trustedClientIp}:${action}`, maximum)) return json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
  }

  if (url.pathname.startsWith("/v1/views/") && request.method === "GET") {
    const view = url.pathname.slice(10);
    // The public pages are remembered for a short while (see ./catalogue-cache); everything
    // tied to a signed-in person is built fresh every time.
    return serveCachedView(getSharedCache(), view, url.search, () => responseOf(handleView(request, view)));
  }
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
  if (url.pathname === "/v1/payments/mobile-money/c2b/register") return responseOf(handleC2bRegistration(request));
  if (url.pathname === "/v1/reports/daily") return responseOf(handleDailyReportSend(request));
  if (url.pathname === "/v1/products/bulk") return responseOf(handleProductsBulk(request));
  if (url.pathname === "/v1/pos/state") return responseOf(posWorkspaceState(request));
  if (url.pathname === "/v1/pos/sessions") return responseOf(handlePosSessions(request));
  const posSessionClose = url.pathname.match(/^\/v1\/pos\/sessions\/(\d+)\/close$/);
  if (posSessionClose) return responseOf(handlePosSessions(request, Number(posSessionClose[1]), "close"));
  if (url.pathname === "/v1/pos/held-sales") return responseOf(handlePosHeldSales(request));
  const posHeldSale = url.pathname.match(/^\/v1\/pos\/held-sales\/(\d+)$/);
  if (posHeldSale) return responseOf(handlePosHeldSales(request, Number(posHeldSale[1])));
  if (url.pathname === "/v1/pos/expenses") return responseOf(handlePosExpenses(request));
  const posExpense = url.pathname.match(/^\/v1\/pos\/expenses\/(\d+)$/);
  if (posExpense) return responseOf(handlePosExpenses(request, Number(posExpense[1])));
  if (url.pathname === "/v1/pos/stock-receipts") return responseOf(handlePosStockReceipts(request));
  const posStockReceiptImage = url.pathname.match(/^\/v1\/pos\/stock-receipts\/(\d+)\/image$/);
  if (posStockReceiptImage) return responseOf(handlePosStockReceipts(request, Number(posStockReceiptImage[1]), true));
  if (url.pathname === "/v1/pos/reports") return responseOf(handlePosReports(request));
  if (url.pathname === "/v1/vat/remittances") return responseOf(handleVatRemittances(request));
  const incomingPaymentMatch = url.pathname.match(/^\/v1\/payments\/incoming\/(\d+)\/match$/);
  if (incomingPaymentMatch) return responseOf(handleIncomingPaymentMatch(request, Number(incomingPaymentMatch[1])));
  if (url.pathname === "/v1/payments/incoming") return responseOf(handleIncomingPaymentsDelete(request));
  const posIncomingPaymentConfirmation = url.pathname.match(/^\/v1\/payments\/incoming\/(\d+)\/confirm-pos$/);
  if (posIncomingPaymentConfirmation) return responseOf(handlePosIncomingPaymentConfirm(request, Number(posIncomingPaymentConfirmation[1])));
  const paymentReviewMatch = url.pathname.match(/^\/v1\/payments\/(\d+)\/review$/);
  if (paymentReviewMatch) return responseOf(handlePaymentReview(request, Number(paymentReviewMatch[1])));
  if (url.pathname === "/v1/walk-in-sales") return responseOf(handlePosSale(request));
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
  const variantMatch = url.pathname.match(/^\/v1\/products\/(\d+)\/variants$/);
  if (variantMatch) return responseOf(handleProductVariants(request, Number(variantMatch[1])));
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
    if (request.method === "POST" && await rateLimited(`${trustedClientIp}:consultation`, 10)) return json({ error: "Too many consultation requests. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
    return responseOf(handleConsultations(request));
  }
  const consultationMessageMatch = url.pathname.match(/^\/v1\/consultations\/(\d+)\/messages$/);
  if (consultationMessageMatch) {
    if (await rateLimited(`${trustedClientIp}:consultation-message`, 60)) return json({ error: "Too many messages. Try again shortly." }, { status: 429, headers: { "Retry-After": "900" } });
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
    if (await rateLimited(`${trustedClientIp}:delivery-quote`, 120)) return json({ error: "Too many delivery quotes. Try again shortly." }, { status: 429, headers: { "Retry-After": "900" } });
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
    const request = webRequest(nodeRequest);
    const response = await route(request, ip);
    // An edit to products, categories, offers, banners, blogs, settings or stores makes every
    // remembered public page out of date; this moves the version they are all keyed by,
    // before the answer goes back, so the very next page load already sees the change.
    const pathname = new URL(request.url).pathname;
    const cache = getSharedCache();
    if (changesCatalogue(request.method, pathname, response.status)) await cache.bump("catalogue");
    // Anyone whose access just changed (signed out, suspended, password reset, role or
    // permissions edited) must lose it on the very next request, so every remembered session
    // is made stale rather than waiting for it to expire.
    if (changesSessions(request.method, pathname, response.status)) await cache.bump("sessions");
    if (changesCounts(request.method, pathname, response.status)) await cache.bump("counts");
    await send(nodeResponse, securityHeaders(response, origin));
  } catch (error) {
    const reference = Math.random().toString(36).slice(2, 10);
    console.error(`[${reference}]`, error);
    await send(nodeResponse, securityHeaders(json({ error: "The API could not complete this request.", reference }, { status: 500 }), origin));
  }
});

// The API can run on its own (its own port) or inside the storefront's process, which is how
// the single-app deployment runs it: the root server.cjs sets HEALTHFIELD_EMBEDDED, imports
// this bundle, and hands it the requests for /v1, /health and /uploads/products.
const embedded = process.env.HEALTHFIELD_EMBEDDED === "1";
const port = Number(process.env.PORT || 3001);
if (process.env.RUN_MIGRATIONS !== "false") await migrate(getDb(), { migrationsFolder: resolve(process.cwd(), "drizzle") });
const server = embedded ? null : app.listen(port, "0.0.0.0", () => console.log(`Healthfield API listening on ${port}`));
/** The request handler, for a host process that owns the HTTP server. */
export const handler = app;
// BACKGROUND_JOBS=false keeps this process from running the scheduled work below (payment
// reconciliation, M-Pesa recovery, the daily report). It exists so a second copy of the app can be
// tested against the live database without every job running twice.
const backgroundJobs = process.env.BACKGROUND_JOBS !== "false";
const every = (milliseconds: number, label: string, job: () => Promise<unknown>) => {
  if (!backgroundJobs) return undefined;
  const timer = setInterval(() => void job().catch((error) => console.error(label, error)), milliseconds);
  timer.unref();
  return timer;
};
const after = (milliseconds: number, label: string, job: () => Promise<unknown>) => {
  if (!backgroundJobs) return undefined;
  const timer = setTimeout(() => void job().catch((error) => console.error(label, error)), milliseconds);
  timer.unref();
  return timer;
};
if (!backgroundJobs) console.log("Background jobs are off (BACKGROUND_JOBS=false).");
const paymentMaintenance = every(30_000, "Payment cancellation maintenance failed", finalizeExpiredPaymentCancellations);
const initialStkReconciliation = after(15_000, "Initial STK reconciliation failed", reconcilePendingStkPayments);
const stkReconciliation = every(30_000, "Scheduled STK reconciliation failed", reconcilePendingStkPayments);
const initialPaymentRecovery = after(60_000, "Initial M-Pesa Pull recovery failed", () => recoverMissedMpesaPayments(null, 2));
const paymentRecovery = every(15 * 60_000, "Scheduled M-Pesa Pull recovery failed", () => recoverMissedMpesaPayments(null, 2));
// The end-of-day note. Checked every twenty minutes rather than scheduled for eleven:
// Passenger idles this process out, so the report is sent by whichever tick first finds
// the trading day past 23:00, and the activity-log guard keeps it to one a day.
const dailyReport = every(20 * 60_000, "Daily sales report failed", runDailyReportIfDue);

let shuttingDown = false;
/** Stops the background work and closes the database and cache. The host calls this when embedded. */
export async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(paymentMaintenance);
  clearTimeout(initialStkReconciliation);
  clearInterval(stkReconciliation);
  clearTimeout(initialPaymentRecovery);
  clearInterval(paymentRecovery);
  clearInterval(dailyReport);
  console.log(`Healthfield API received ${signal}; closing server and database pool.`);
  const forceExit = setTimeout(() => process.exit(0), 5_000);
  forceExit.unref();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  await closeSharedCache();
  if (!embedded) process.exit(0);
}
if (!embedded) for (const signal of ["SIGTERM", "SIGINT", "SIGUSR2"] as const) process.once(signal, () => void shutdown(signal));
