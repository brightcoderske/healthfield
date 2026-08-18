import { proxyToBackend } from "@/lib/backend-api";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return proxyToBackend(request, `/v1/views/consultation/${(await params).id}`); }
