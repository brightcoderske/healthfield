import { proxyToBackend } from "@/lib/backend-api";
export async function GET(request: Request) { return proxyToBackend(request, "/v1/settings"); }
export async function PUT(request: Request) { return proxyToBackend(request, "/v1/settings"); }
