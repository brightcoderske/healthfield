import { proxyToBackend } from "@/lib/backend-api";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) { return proxyToBackend(request, `/v1/delivery/bands/${(await params).id}`); }
export async function DELETE(request: Request, { params }: Params) { return proxyToBackend(request, `/v1/delivery/bands/${(await params).id}`); }
