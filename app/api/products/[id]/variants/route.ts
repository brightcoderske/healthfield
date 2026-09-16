import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath, revalidateTag } from "next/cache";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const response = await proxyToBackend(request, `/v1/products/${id}/variants`);
  if (response.ok) {
    // Saving a list of options can create, rename or switch off several product rows at
    // once, so the whole catalogue is refreshed rather than just this one page.
    revalidateTag(`product:${id}`, { expire: 0 });
    revalidatePath(`/products/${id}`);
    revalidatePath("/");
  }
  return response;
}
