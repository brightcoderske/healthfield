import { proxyToBackend } from "@/lib/backend-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyToBackend(request, `/v1/pos/sessions/${encodeURIComponent(id)}/close`);
}
