// Product images are stored on the API host, but its firewall challenges ordinary
// browsers — a redirect there left every card on "Image pending". Only the storefront's
// own servers are allowed through, so the image is fetched here and handed on. File
// names are random and never reused, so the CDN keeps each one indefinitely and the
// API is asked for a given image about once per edge region, not once per visitor.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const filename = (await params).filename;
  if (!/^[a-zA-Z0-9-]+\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(filename))
    return new Response("Image not found.", { status: 404 });
  const api = (
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "https://api.healthfieldpharmacy.co.ke"
  ).replace(/\/$/, "");
  // Images are public on the API, so no key is sent along with the request.
  const upstream = await fetch(`${api}/uploads/products/${filename}`, {
    cache: "no-store",
  }).catch(() => null);
  const type = upstream?.headers.get("content-type") || "";
  // The firewall answers with an HTML page and a 200, so the type is checked as well as
  // the status. A failure is not cached, so the image returns once the host recovers.
  if (!upstream?.ok || !type.startsWith("image/"))
    return new Response("Image not found.", {
      status: upstream?.status === 404 ? 404 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
