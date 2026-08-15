import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { ReceiptPdf } from "@/app/admin/receipts/orders/[id]/receipt-pdf";
import { receiptBarcode, receiptLogoDataUrl } from "@/app/admin/receipts/orders/[id]/receipt-assets";
import { prepareThermalReceipt, receiptDownloadFilename, type ReceiptApiData } from "@/app/admin/receipts/orders/[id]/thermal-receipt-data";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireStaffPermission("RECEIPTS_VIEW");
  const data = await backendJson<ReceiptApiData>(`/v1/views/staff/receipts/orders/${(await params).id}`);
  const receipt = prepareThermalReceipt(data);
  const [barcodeDataUrl, logoDataUrl] = await Promise.all([receiptBarcode(receipt.receiptNumber), receiptLogoDataUrl()]);
  const pdf = await renderToBuffer(createElement(ReceiptPdf, { ...receipt, barcodeDataUrl, logoDataUrl }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${receiptDownloadFilename(data.order, receipt.branch?.code)}"`, "Cache-Control": "private, no-store" } });
}
