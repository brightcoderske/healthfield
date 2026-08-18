import { proxyToBackend } from "@/lib/backend-api";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return proxyToBackend(request, `/v1/consultations/${(await params).id}`); }
