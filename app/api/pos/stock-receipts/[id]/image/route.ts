import { proxyToBackend } from "@/lib/backend-api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/v1/pos/stock-receipts/${encodeURIComponent(id)}/image`);
}
