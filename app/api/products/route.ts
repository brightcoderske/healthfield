import { proxyToBackend } from "@/lib/backend-api";
export async function GET(request: Request) { return proxyToBackend(request, "/v1/products"); }
export async function POST(request: Request) { return proxyToBackend(request, "/v1/products"); }
