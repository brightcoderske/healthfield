import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { prescriptions } from "@/db/schema";
import { getSession } from "@/lib/auth";

const allowed = new Map([
  ["application/pdf", ".pdf"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
]);

function signatureMatches(type: string, bytes: Uint8Array) {
  if (type === "application/pdf") return bytes.slice(0, 4).toString() === "37,80,68,70";
  if (type === "image/png") return bytes.slice(0, 8).toString() === "137,80,78,71,13,10,26,10";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log in before uploading a prescription." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("prescription");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a prescription file." }, { status: 400 });
  const extension = allowed.get(file.type);
  if (!extension) return NextResponse.json({ error: "Only PDF, PNG, JPG and JPEG files are supported." }, { status: 415 });
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "The file must be smaller than 10 MB." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(file.type, bytes)) return NextResponse.json({ error: "The file content does not match its format." }, { status: 400 });

  const directory = path.join(process.cwd(), "storage", "prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${extension}`;
  await writeFile(path.join(directory, storedName), bytes, { flag: "wx" });
  const [created] = await getDb().insert(prescriptions).values({
    customerId: session.userId,
    storageKey: storedName,
    originalFilename: path.basename(file.name).slice(0, 255),
    mimeType: file.type,
    sizeBytes: file.size,
    status: "RECEIVED",
  });
  return NextResponse.json({ ok: true, id: created.insertId }, { status: 201 });
}
