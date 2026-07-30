import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      service: "healthfield-pharmacy",
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        // Health checks must never leak configuration or become stale in LiteSpeed.
        "Cache-Control": "no-store",
      },
    },
  );
}
