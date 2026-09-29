import { proxyToBackend } from "@/lib/backend-api";

export async function DELETE(request: Request) { return proxyToBackend(request, "/v1/payments/incoming"); }
