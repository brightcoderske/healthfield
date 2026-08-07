import { proxyToBackend } from "@/lib/backend-api";

export async function GET(request: Request) {
  const query = new URL(request.url).search;
  return proxyToBackend(request, `/v1/payments/status${query}`);
}
