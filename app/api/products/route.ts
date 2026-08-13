import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath } from "next/cache";
export async function GET(request: Request) { return proxyToBackend(request, "/v1/products"); }
export async function POST(request: Request) {
  const response = await proxyToBackend(request, "/v1/products");
  if (response.ok) revalidatePath("/");
  return response;
}
