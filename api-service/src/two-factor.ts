import { createHash, timingSafeEqual } from "node:crypto";

export const twoFactorValidityMs = 10 * 60_000;
export const twoFactorChallengeLifetimeMs = 45 * 60_000;
export const twoFactorResendCooldownMs = 60_000;
export const twoFactorMaximumAttempts = 6;
export const twoFactorMaximumResends = 5;

export function twoFactorCodeHash(challengeToken: string, code: string) {
  return createHash("sha256").update(`${challengeToken}:${code}`).digest("hex");
}

export function secureHashEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function twoFactorTiming(now: number) {
  return {
    expiresAtMs: now + twoFactorValidityMs,
    resendAvailableAtMs: now + twoFactorResendCooldownMs,
  };
}
