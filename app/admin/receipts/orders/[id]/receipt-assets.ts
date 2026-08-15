import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import bwipjs from "bwip-js";

export async function receiptBarcode(receiptNumber: string) {
  const barcode = await bwipjs.toBuffer({ bcid: "code128", text: receiptNumber, scale: 2, height: 7, includetext: false, paddingwidth: 0, paddingheight: 0, backgroundcolor: "FFFFFF" });
  return `data:image/png;base64,${barcode.toString("base64")}`;
}

export async function receiptLogoDataUrl() {
  const logo = await readFile(path.join(process.cwd(), "public", "healthfield-logo-clean.png"));
  return `data:image/png;base64,${logo.toString("base64")}`;
}
