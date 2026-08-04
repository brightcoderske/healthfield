import { proxyToBackend } from "@/lib/backend-api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const response = await proxyToBackend(request, "/v1/auth/upload-token");
  if (!response.ok) return response;
  const data = await response.json() as { token: string; expiresIn: number };
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL;
  if (!apiUrl) return NextResponse.json({ error: "Upload service is not configured." }, { status: 503 });
  return NextResponse.json({ ...data, apiUrl: apiUrl.replace(/\/$/, "") });
}
