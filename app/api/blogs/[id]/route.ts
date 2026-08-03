import { proxyToBackend } from "@/lib/backend-api";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){return proxyToBackend(request,`/v1/blogs/${(await params).id}`)}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){return proxyToBackend(request,`/v1/blogs/${(await params).id}`)}
