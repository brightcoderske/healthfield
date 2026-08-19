import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutToken } from "./checkout-token.ts";

const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function withCrypto<T>(replacement: unknown, body: () => T) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: replacement, configurable: true });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  }
}

test("uses randomUUID where the browser offers it", () => {
  const token = withCrypto({ randomUUID: () => "11111111-2222-4333-8444-555555555555" }, createCheckoutToken);
  assert.equal(token, "11111111-2222-4333-8444-555555555555");
});

test("falls back to getRandomValues outside a secure context", () => {
  // This is the phone-on-a-LAN-address case: crypto exists, randomUUID does not, and
  // checkout used to throw here before it could render.
  const token = withCrypto(
    { getRandomValues: (array: Uint8Array) => { array.fill(0xab); return array; } },
    createCheckoutToken,
  );
  assert.match(token, v4, `not a v4 UUID: ${token}`);
});

test("the fallback stamps the version and variant bits correctly", () => {
  // All-zero bytes would produce an invalid UUID unless the bits are set explicitly.
  const token = withCrypto(
    { getRandomValues: (array: Uint8Array) => { array.fill(0x00); return array; } },
    createCheckoutToken,
  );
  assert.match(token, v4);
  assert.equal(token[14], "4", "version nibble must be 4");
  assert.ok(["8", "9", "a", "b"].includes(token[19]), "variant nibble must be 8-b");
});

test("the fallback is random rather than a fixed string", () => {
  let counter = 0;
  const token = () => withCrypto(
    { getRandomValues: (array: Uint8Array) => { array.forEach((_, index) => { array[index] = (counter += 7) % 256; }); return array; } },
    createCheckoutToken,
  );
  assert.notEqual(token(), token());
});

test("refuses to invent a token without a cryptographic source", () => {
  // The token is what the payment-status endpoint looks an order up by, so a guessable
  // one would expose someone else's order. Failing is the only safe outcome.
  assert.throws(() => withCrypto({}, createCheckoutToken), /secure checkout reference/i);
  assert.throws(() => withCrypto(undefined, createCheckoutToken), /secure checkout reference/i);
});
