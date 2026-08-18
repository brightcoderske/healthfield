import path from "node:path";
import sharp from "sharp";

// Storage, validation and image handling for prescription documents and the
// attachments patients send during a consultation. Both paths share this module so
// a new upload surface cannot quietly ship with weaker checks than the original.

export function storageRoot() {
  return path.resolve(process.env.STORAGE_ROOT || path.join(process.cwd(), "storage"));
}

export async function optimizePrescriptionImage(bytes: Buffer<ArrayBufferLike>, type: string): Promise<Buffer<ArrayBufferLike>> {
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    const optimized = type === "image/png" ? await image.png({ compressionLevel:9, adaptiveFiltering:true }).toBuffer()
      : type === "image/webp" ? await image.webp({ quality:86, effort:4 }).toBuffer()
      : type === "image/avif" ? await image.avif({ quality:65, effort:4 }).toBuffer()
      : type === "image/tiff" ? await image.tiff({ quality:85, compression:"lzw" }).toBuffer()
      : await image.jpeg({ quality:86, progressive:true, mozjpeg:true }).toBuffer();
    return optimized.length < bytes.length ? optimized : bytes;
  } catch (error) {
    console.warn("Prescription image optimization skipped", { name:error instanceof Error ? error.name : undefined });
    return bytes;
  }
}

export const PRESCRIPTION_UPLOAD_MAXIMUM_BYTES = 10 * 1024 * 1024;

const allowedTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["image/tiff", ".tiff"],
]);

export type PrescriptionUploadRejection = { ok: false; error: string; status: number };
export type PrescriptionUploadAcceptance = { ok: true; extension: string; bytes: Buffer<ArrayBufferLike> };

// The declared content type is never trusted on its own: the leading bytes must
// agree with it, so a script renamed to .png cannot reach the storage directory.
export function prescriptionFileSignatureMatches(bytes: Buffer<ArrayBufferLike>, type: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  return type === "application/pdf" ? ascii(0,4) === "%PDF"
    : type === "image/png" ? ascii(1,4) === "PNG"
    : type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : type === "image/webp" ? ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP"
    : type === "image/avif" ? ascii(4,8) === "ftyp" && ["avif","avis"].includes(ascii(8,12))
    : ascii(0,4) === "II*\0" || ascii(0,4) === "MM\0*";
}

export async function validatePrescriptionUpload(file: File): Promise<PrescriptionUploadRejection | PrescriptionUploadAcceptance> {
  const extension = allowedTypes.get(file.type);
  if (!extension) return { ok: false, error: "Supported files are PDF, JPG, JPEG, PNG, WebP, AVIF and TIFF.", status: 415 };
  if (file.size <= 0 || file.size > PRESCRIPTION_UPLOAD_MAXIMUM_BYTES) return { ok: false, error: "The file must be 10 MB or smaller.", status: 413 };
  let bytes: Buffer<ArrayBufferLike> = Buffer.from(await file.arrayBuffer());
  if (!prescriptionFileSignatureMatches(bytes, file.type)) return { ok: false, error: "The file content does not match its format.", status: 400 };
  if (file.type !== "application/pdf") bytes = await optimizePrescriptionImage(bytes, file.type);
  return { ok: true, extension, bytes };
}
