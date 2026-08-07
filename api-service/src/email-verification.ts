export const emailVerificationValidityMs = 24 * 60 * 60 * 1000;
export const emailVerificationResendCooldownMs = 60_000;

export function emailVerificationTiming(now: number) {
  return { expiresAtMs: now + emailVerificationValidityMs };
}

export function emailVerificationRetryAfterSeconds(expiresAtMs: number | null, now: number) {
  if (!expiresAtMs) return 0;
  const sentAtMs = expiresAtMs - emailVerificationValidityMs;
  return Math.max(0, Math.ceil((sentAtMs + emailVerificationResendCooldownMs - now) / 1000));
}
