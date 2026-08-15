export function healthfieldOrderNumber(branchCode: string, orderId: number) {
  const code = branchCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "WEB";
  return `HF-${code}-${String(orderId).padStart(4, "0")}`;
}
