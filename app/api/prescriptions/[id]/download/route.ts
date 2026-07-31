import { proxyToBackend } from "@/lib/backend-api";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return proxyToBackend(request, `/v1/prescriptions/${(await params).id}/download`); }
