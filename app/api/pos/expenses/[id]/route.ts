import { proxyToBackend } from "@/lib/backend-api";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/v1/pos/expenses/${encodeURIComponent(id)}`);
}
