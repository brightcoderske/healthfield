import { proxyToBackend } from "@/lib/backend-api";
import { revalidatePath, revalidateTag } from "next/cache";

async function mutate(request: Request, id: string) {
  const response = await proxyToBackend(request, `/v1/blogs/${id}`);
  if (response.ok) {
    const data = (await response.clone().json().catch(() => ({}))) as { slug?: string };
    revalidateTag("blogs", { expire: 0 });
    revalidatePath("/blog");
    if (data.slug) {
      revalidateTag(`blog:${data.slug}`, { expire: 0 });
      revalidatePath(`/blog/${data.slug}`);
    } else {
      // Existing PATCH responses did not return the slug, so expire every
      // article path until the API includes that identifier.
      revalidatePath("/blog/[slug]", "page");
    }
  }
  return response;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id);
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id);
}
