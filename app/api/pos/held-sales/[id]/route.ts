import { proxyToBackend } from "@/lib/backend-api";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/v1/pos/held-sales/${encodeURIComponent(id)}`);
}
