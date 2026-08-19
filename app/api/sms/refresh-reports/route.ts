import { proxyToBackend } from "@/lib/backend-api";
export async function POST(request: Request) { return proxyToBackend(request, "/v1/sms/refresh-reports"); }
