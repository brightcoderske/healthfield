export function paymentPollDelay(attempt: number) {
  if (attempt < 3) return 5_000;
  if (attempt < 6) return 10_000;
  if (attempt < 10) return 20_000;
  if (attempt < 15) return 30_000;
  return 60_000;
}
