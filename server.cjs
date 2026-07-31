const http = require("http");
const next = require("next");
const fs = require("fs");
const path = require("path");

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

app.prepare().then(() => {
  http.createServer((request, response) => {
    if (!serveProductImage(request, response)) handle(request, response);
  })
    .listen(port, hostname, () => {
      console.log(`Healthfield Pharmacy is ready on ${hostname}:${port}`);
    });
});
