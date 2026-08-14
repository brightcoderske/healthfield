export function paymentPollDelay(attempt: number) {
  if (attempt < 3) return 5_000;
  if (attempt < 6) return 10_000;
  if (attempt < 10) return 20_000;
  if (attempt < 15) return 30_000;
  return 60_000;
}

// Manual Till checks only read Healthfield's database for a C2B/Pull/status
// callback that has already arrived. They do not send a request to Safaricom,
// so the POS can check more promptly without increasing Daraja traffic.
export function manualTillPollDelay(attempt: number) {
  if (attempt < 15) return 2_000;
  if (attempt < 30) return 5_000;
  return 15_000;
}
