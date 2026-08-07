import assert from "node:assert/strict";
import test from "node:test";
import {
  secureHashEqual,
  twoFactorCodeHash,
  twoFactorMaximumResends,
  twoFactorResendCooldownMs,
  twoFactorTiming,
  twoFactorValidityMs,
} from "./two-factor.ts";

test("an emailed code is bound to its opaque login challenge", () => {
  const challenge = "a".repeat(72);
  const expected = twoFactorCodeHash(challenge, "012345");

  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(secureHashEqual(expected, twoFactorCodeHash(challenge, "012345")), true);
  assert.equal(secureHashEqual(expected, twoFactorCodeHash(challenge, "12345")), false);
  assert.equal(secureHashEqual(expected, twoFactorCodeHash("b".repeat(72), "012345")), false);
});

test("malformed stored hashes are rejected without throwing", () => {
  const valid = twoFactorCodeHash("challenge", "123456");
  assert.equal(secureHashEqual("not-a-hash", valid), false);
  assert.equal(secureHashEqual(valid, ""), false);
});

test("server timing uses one ten-minute expiry and one-minute resend cooldown", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(twoFactorTiming(now), {
    expiresAtMs: now + twoFactorValidityMs,
    resendAvailableAtMs: now + twoFactorResendCooldownMs,
  });
  assert.equal(twoFactorMaximumResends, 5);
});
