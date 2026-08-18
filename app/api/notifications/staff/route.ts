import { proxyToBackend } from "@/lib/backend-api";
export async function GET(request: Request) { return proxyToBackend(request, "/v1/views/staff/navigation"); }
