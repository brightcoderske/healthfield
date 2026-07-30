import { readFile } from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { prescriptions } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["STAFF", "ADMIN", "SUPER_ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Pharmacy access required." }, { status: 403 });
  }
  const id = Number((await params).id);
  const [record] = await getDb().select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1);
  if (!record) return NextResponse.json({ error: "Prescription not found." }, { status: 404 });
  const safeName = path.basename(record.storageKey);
  const buffer = await readFile(path.join(process.cwd(), "storage", "prescriptions", safeName));
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Disposition": `inline; filename="${record.originalFilename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
