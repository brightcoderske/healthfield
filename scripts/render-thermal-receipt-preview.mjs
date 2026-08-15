import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import bwipjs from "bwip-js";
import { build } from "esbuild";
import { createElement } from "react";

const root = process.cwd();
const temporaryDirectory = path.join(root, "tmp", "pdfs");
const outputDirectory = path.join(root, "output", "pdf");
await mkdir(temporaryDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const bundle = path.join(temporaryDirectory, "thermal-receipt-pdf-component.mjs");
await build({
  entryPoints: [path.join(root, "app", "admin", "receipts", "orders", "[id]", "receipt-pdf.tsx")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
});

const { ReceiptPdf } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
const logo = await readFile(path.join(root, "public", "healthfield-logo-clean.png"));
const barcode = await bwipjs.toBuffer({ bcid: "code128", text: "0001234C", scale: 2, height: 7, includetext: false, paddingwidth: 0, paddingheight: 0, backgroundcolor: "FFFFFF" });
const props = {
  order: { id: 1234, orderNumber: "HF-JJC-1234", customerName: "Jane Njeri", phone: "0700123456", email: "jane@example.com", fulfilmentMethod: "PICKUP", paymentStatus: "PAID", paymentMethod: "MANUAL_MPESA", paymentReference: "UHEBD338CW", amountPaid: "720.00", subtotal: "670.00", deliveryFee: "100.00", discount: "50.00", total: "720.00", suggestedBranchId: 2, createdAt: "2026-08-15T08:30:00.000Z" },
  items: [
    { productName: "Panadol Extra", packSize: "12 Tablets", quantity: 1, unitPrice: "120.00", lineTotal: "120.00" },
    { productName: "Vitamin C 1000mg Immune Support Effervescent Tablets", packSize: "30 Tablets", quantity: 1, unitPrice: "350.00", lineTotal: "350.00" },
    { productName: "Dettol Original Antibacterial Bathing Soap", quantity: 2, unitPrice: "100.00", lineTotal: "200.00" },
  ],
  payment: { method: "MANUAL_MPESA", channel: "POS", status: "PAID", amount: "720.00", receiptNumber: "UHEBD338CW", createdAt: "2026-08-15T08:31:00.000Z", verifiedAt: "2026-08-15T08:32:00.000Z" },
  branch: { id: 2, name: "Juja Town Branch", code: "JJC", phone: "0700 123 456", address: "Kenyatta Road, Juja" },
  business: { pharmacyName: "Healthfield Pharmacy", phone: "0700 123 456", address: "Juja, Kenya", licenceNumber: "PPB/PHARM/1234" },
  servedBy: "Alice Kamau",
  receiptNumber: "0001234C",
  barcodeDataUrl: `data:image/png;base64,${barcode.toString("base64")}`,
  logoDataUrl: `data:image/png;base64,${logo.toString("base64")}`,
};

const pdf = await renderToBuffer(createElement(ReceiptPdf, props));
const output = path.join(outputDirectory, "healthfield-thermal-receipt-preview.pdf");
await writeFile(output, pdf);
console.log(output);
