import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath, revalidateTag } from "next/cache";

async function mutate(request: Request, id: string) {
  const response = await proxyToBackend(request, `/v1/products/${id}`);
  if (response.ok) {
    revalidateTag(`product:${id}`, { expire: 0 });
    revalidatePath(`/products/${id}`);
    revalidatePath("/");
  }
  return response;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id);
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id);
}
