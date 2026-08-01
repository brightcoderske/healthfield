import { proxyToBackend } from "@/lib/backend-api";
import { CART_COOKIE } from "@/lib/shopping-state";
export async function POST(request: Request) { const response=await proxyToBackend(request,"/v1/orders");if(response.ok)response.cookies.set(CART_COOKIE,"",{path:"/",maxAge:0});return response; }
