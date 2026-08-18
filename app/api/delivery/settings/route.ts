import { proxyToBackend } from "@/lib/backend-api";
export async function PATCH(request: Request) { return proxyToBackend(request, "/v1/delivery/settings"); }
