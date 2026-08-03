import { proxyToBackend } from "@/lib/backend-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return proxyToBackend(request, `/v1/products/${(await params).id}/reviews`); }
