import { proxyAuth } from "@/lib/backend-api";
export async function POST(request: Request) { return proxyAuth(request, "register"); }
