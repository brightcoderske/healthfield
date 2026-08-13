import { proxyToBackend } from "@/lib/backend-api";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const{id}=await params;return proxyToBackend(request,`/v1/payments/incoming/${id}/confirm-pos`)}
