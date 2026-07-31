import { createUploadToken, getSession } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL;
  if (!apiUrl) return NextResponse.json({ error: "Upload service is not configured." }, { status: 503 });

  return NextResponse.json({
    token: await createUploadToken(session),
    apiUrl: apiUrl.replace(/\/$/, ""),
    expiresIn: 300,
  });
}
