import assert from "node:assert/strict";
import test from "node:test";
import { accessToken, clearMpesaTokenCache, setMpesaTokenStore, type MpesaConfiguration, type MpesaTokenStore } from "./mpesa.ts";

// Obviously fake values: nothing here is a credential.
const config: MpesaConfiguration = {
  baseUrl: "https://sandbox.example.test",
  consumerKey: "TEST-CONSUMER-KEY",
  consumerSecret: "TEST-CONSUMER-SECRET",
  shortcode: "174379",
  partyB: "174379",
  passkey: "TEST-PASSKEY",
  transactionType: "CustomerPayBillOnline",
  callbackSecret: "test-callback-secret-0123456789",
  callbackBaseUrl: "https://api.example.test",
};

/** Stands in for Safaricom, counting how many times a token is asked for. */
function fakeSafaricom(expiresIn = 3599) {
  const original = globalThis.fetch;
  const state = { requests: 0 };
  globalThis.fetch = (async () => {
    state.requests += 1;
    return new Response(JSON.stringify({ access_token: `token-${state.requests}`, expires_in: String(expiresIn) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { state, restore: () => { globalThis.fetch = original; } };
}

function memoryStore() {
  const rows = new Map<string, { value: string; ttl: number }>();
  const store: MpesaTokenStore = {
    async get(key) { return rows.get(key)?.value ?? null; },
    async set(key, value, ttl) { rows.set(key, { value, ttl }); },
  };
  return { rows, store };
}

test("one worker's token is reused by another instead of asking Safaricom again", async () => {
  const safaricom = fakeSafaricom();
  const { store } = memoryStore();
  try {
    setMpesaTokenStore(store);
    clearMpesaTokenCache();
    assert.equal(await accessToken(config), "token-1");
    assert.equal(safaricom.state.requests, 1);
    // A different worker, or this one after a restart: it starts with no copy of its own.
    clearMpesaTokenCache();
    assert.equal(await accessToken(config), "token-1");
    assert.equal(safaricom.state.requests, 1, "the shared token should have been used");
  } finally {
    safaricom.restore();
    setMpesaTokenStore(null);
    clearMpesaTokenCache();
  }
});

test("the stored token lapses a little before the real one, and its key reveals no credentials", async () => {
  const safaricom = fakeSafaricom(3599);
  const { rows, store } = memoryStore();
  try {
    setMpesaTokenStore(store);
    clearMpesaTokenCache();
    await accessToken(config);
    const [[key, row]] = [...rows.entries()];
    assert.equal(row.ttl, 3599 - 120);
    assert.match(key, /^mpesa:token:[0-9a-f]{24}$/);
    assert.ok(!key.includes(config.consumerKey) && !key.includes(config.consumerSecret));
  } finally {
    safaricom.restore();
    setMpesaTokenStore(null);
    clearMpesaTokenCache();
  }
});

test("a token that is about to lapse is not taken from the shared copy", async () => {
  const safaricom = fakeSafaricom();
  const { rows, store } = memoryStore();
  try {
    setMpesaTokenStore(store);
    clearMpesaTokenCache();
    await accessToken(config);
    const [key] = [...rows.keys()];
    rows.set(key, { value: JSON.stringify({ value: "stale-token", expiresAt: Date.now() + 10_000 }), ttl: 10 });
    clearMpesaTokenCache();
    assert.equal(await accessToken(config), "token-2", "ten seconds of life left is too little");
  } finally {
    safaricom.restore();
    setMpesaTokenStore(null);
    clearMpesaTokenCache();
  }
});

test("a broken shared store is ignored and the token is fetched as before", async () => {
  const safaricom = fakeSafaricom();
  try {
    setMpesaTokenStore({ async get() { throw new Error("store down"); }, async set() { throw new Error("store down"); } });
    clearMpesaTokenCache();
    assert.equal(await accessToken(config), "token-1");
  } finally {
    safaricom.restore();
    setMpesaTokenStore(null);
    clearMpesaTokenCache();
  }
});

test("with no shared store each worker keeps its own token, exactly as before", async () => {
  const safaricom = fakeSafaricom();
  try {
    setMpesaTokenStore(null);
    clearMpesaTokenCache();
    await accessToken(config);
    assert.equal(await accessToken(config), "token-1", "reused within the same worker");
    clearMpesaTokenCache();
    assert.equal(await accessToken(config), "token-2", "a fresh worker has to ask");
  } finally {
    safaricom.restore();
    clearMpesaTokenCache();
  }
});
