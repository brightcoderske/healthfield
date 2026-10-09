// The hosting account counts every thread against its process limit, and native libraries size their
// pools by the host's CPU count (one Rust runtime started 64 workers on this server). These are set
// before anything that uses them is loaded; a value already present in the environment wins.
for (const [name, value] of Object.entries({ TOKIO_WORKER_THREADS: "1", RAYON_NUM_THREADS: "1", UV_THREADPOOL_SIZE: "2", VIPS_CONCURRENCY: "1" })) {
  if (!process.env[name]) process.env[name] = value;
}

const http = require("http");
const net = require("net");
const next = require("next");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const productUploadRoot = path.resolve(process.cwd(), "public", "uploads", "products");
const productImageTypes = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
};

function serveProductImage(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const match = requestUrl.pathname.match(/^\/uploads\/products\/([a-zA-Z0-9-]+\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?))$/i);
  if (!match || !["GET", "HEAD"].includes(request.method || "GET")) return false;

  const filename = match[1];
  const imagePath = path.join(productUploadRoot, filename);
  fs.stat(imagePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Image not found.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": productImageTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(imagePath).pipe(response);
  });
  return true;
}

// One app, one process. The API is built into api-service/dist and runs inside this process:
// requests for /v1, /health and /uploads/products go to it, everything else to Next. The
// storefront's own server-side calls to the API (API_BASE_URL) go to a second listener on the
// loopback interface only, on a port the system picks, so nothing outside can reach it.
// Set EMBED_API=false to run the storefront alone against an API hosted elsewhere.
const apiBundle = path.resolve(process.cwd(), "api-service", "dist", "server.mjs");
const embedApi = process.env.EMBED_API !== "false" && fs.existsSync(apiBundle);
const apiPrefixes = ["/v1", "/health", "/uploads/products/"];

function belongsToApi(request) {
  const pathname = (request.url || "/").split("?")[0];
  return apiPrefixes.some((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

async function start() {
  await app.prepare();
  let api = null;
  if (embedApi) {
    process.env.HEALTHFIELD_EMBEDDED = "1";
    api = await import(pathToFileURL(apiBundle).href);
  }

  const server = http.createServer((request, response) => {
    if (api && belongsToApi(request)) return api.handler(request, response);
    if (!api && serveProductImage(request, response)) return;
    handle(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      console.log(`Healthfield Pharmacy is ready on ${hostname}:${port}${api ? " (API embedded)" : ""}`);
      resolve();
    });
  });

  if (api) {
    // The storefront's own calls to the API need an address. The host (Passenger) allows one
    // http.Server.listen() per app and silently ignores the next one, so a second http server
    // would never start. A plain net server is not touched by that: it accepts the loopback
    // connections and hands each one to an http server that is never asked to listen itself.
    const internal = http.createServer(api.handler);
    const loopback = net.createServer((socket) => internal.emit("connection", socket));
    const loopbackPort = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      loopback.once("error", () => { clearTimeout(timer); resolve(null); });
      loopback.listen(0, "127.0.0.1", () => { clearTimeout(timer); resolve(loopback.address().port); });
    });
    // API_INTERNAL_URL wins if set; otherwise the loopback port; otherwise (a host that blocks
    // that too) the site's own public address, which routes /v1 to the API for everyone.
    const publicSelf = (process.env.APP_URL || process.env.API_PUBLIC_URL || "").replace(/\/$/, "");
    process.env.API_BASE_URL = (process.env.API_INTERNAL_URL || (loopbackPort ? `http://127.0.0.1:${loopbackPort}` : publicSelf)).replace(/\/$/, "");
    console.log(`Storefront reaches the embedded API at ${process.env.API_BASE_URL}`);
    // A self-test, so the log says at once whether the storefront can really reach the API.
    fetch(`${process.env.API_BASE_URL}/health`).then(
      (reply) => console.log(`Embedded API self-test: ${reply.status}`),
      (error) => console.error(`Embedded API self-test FAILED at ${process.env.API_BASE_URL}: ${error && error.cause ? error.cause.code || error.cause.message : error.message}`),
    );

    let stopping = false;
    const stop = (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`Received ${signal}; stopping.`);
      const force = setTimeout(() => process.exit(0), 8000);
      force.unref();
      server.close();
      loopback.close();
      api.shutdown(signal).finally(() => process.exit(0));
    };
    for (const signal of ["SIGTERM", "SIGINT", "SIGUSR2"]) process.once(signal, () => stop(signal));
  }
}

start().catch((error) => {
  console.error("Healthfield could not start.", error);
  process.exit(1);
});
