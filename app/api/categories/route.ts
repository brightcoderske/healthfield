import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath } from "next/cache";
export async function POST(request: Request) {
  const response = await proxyToBackend(request, "/v1/categories");
  // The storefront caches its home payload, so without this a new category or a moved
  // one takes up to half a minute to show up while someone is checking their own work.
  if (response.ok) revalidatePath("/");
  return response;
}
