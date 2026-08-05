import { proxyLogout } from "@/lib/backend-api";

export async function POST(request: Request) {
  return proxyLogout(request);
}
