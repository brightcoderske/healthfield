import assert from "node:assert/strict";
import test from "node:test";
import {
  emailVerificationResendCooldownMs,
  emailVerificationRetryAfterSeconds,
  emailVerificationTiming,
  emailVerificationValidityMs,
} from "./email-verification.ts";

test("activation links use one authoritative 24-hour expiry", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(emailVerificationTiming(now), { expiresAtMs: now + emailVerificationValidityMs });
});

test("activation resend cooldown is derived from the epoch expiry", () => {
  const now = 1_800_000_000_000;
  const { expiresAtMs } = emailVerificationTiming(now);
  assert.equal(emailVerificationRetryAfterSeconds(expiresAtMs, now), emailVerificationResendCooldownMs / 1000);
  assert.equal(emailVerificationRetryAfterSeconds(expiresAtMs, now + 30_000), 30);
  assert.equal(emailVerificationRetryAfterSeconds(expiresAtMs, now + emailVerificationResendCooldownMs), 0);
  assert.equal(emailVerificationRetryAfterSeconds(null, now), 0);
});
