import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath, revalidateTag } from "next/cache";
export async function GET(request:Request){return proxyToBackend(request,"/v1/blogs")}
export async function POST(request: Request) {
  const response = await proxyToBackend(request, "/v1/blogs");
  if (response.ok) {
    revalidateTag("blogs", { expire: 0 });
    revalidatePath("/blog");
  }
  return response;
}
