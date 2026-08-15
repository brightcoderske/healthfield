import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { backendJson } from "@/lib/backend-api";
import { ReceiptPdf } from "../receipt-pdf";
import { receiptBarcode, receiptLogoDataUrl } from "../receipt-assets";
import { prepareThermalReceipt, receiptDownloadFilename, type ReceiptApiData } from "../thermal-receipt-data";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = await backendJson<ReceiptApiData>(`/v1/views/admin/orders/${(await params).id}`);
  const receipt = prepareThermalReceipt(data);
  const [barcodeDataUrl, logoDataUrl] = await Promise.all([receiptBarcode(receipt.receiptNumber), receiptLogoDataUrl()]);
  const pdf = await renderToBuffer(createElement(ReceiptPdf, { ...receipt, barcodeDataUrl, logoDataUrl }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${receiptDownloadFilename(data.order, receipt.branch?.code)}"`, "Cache-Control": "private, no-store" } });
}
