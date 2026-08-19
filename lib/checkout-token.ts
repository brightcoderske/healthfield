/**
 * A random v4 UUID used as the idempotency key for a checkout.
 *
 * `crypto.randomUUID` only exists in a secure context — HTTPS, or localhost. Testing the
 * storefront from a phone over a LAN address (`http://192.168.x.x:3000`) is not one, so
 * there the property is simply undefined and checkout crashed before it could render.
 *
 * `crypto.getRandomValues` carries no such restriction and is present in every browser
 * this site supports, so the UUID is assembled from it instead.
 *
 * Deliberately no Math.random fallback: the token is what the payment-status endpoint
 * looks an order up by, so a guessable one would expose another customer's order. If no
 * cryptographic source exists, failing loudly is the only safe outcome.
 */
export function createCheckoutToken(): string {
  const source = globalThis.crypto;
  if (source?.randomUUID) return source.randomUUID();
  if (!source?.getRandomValues) {
    throw new Error("This browser cannot generate a secure checkout reference. Update your browser to place an order.");
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  // Stamp the version and variant bits so the result is a well-formed v4 UUID; the API
  // validates the shape and would reject anything else.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
