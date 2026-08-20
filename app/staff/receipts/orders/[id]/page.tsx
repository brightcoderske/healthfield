import { PrintReceiptButton } from "@/app/admin/receipts/orders/[id]/print-button";
import { receiptBarcode } from "@/app/admin/receipts/orders/[id]/receipt-assets";
import { prepareThermalReceipt, type ReceiptApiData } from "@/app/admin/receipts/orders/[id]/thermal-receipt-data";
import { ThermalReceipt } from "@/app/admin/receipts/orders/[id]/thermal-receipt";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export default async function StaffReceipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autoPrint?: string }> }) {
  await requireStaffPermission("RECEIPTS_VIEW");
  const id = Number((await params).id);
  const autoPrint = (await searchParams).autoPrint === "1";
  const data = await backendJson<ReceiptApiData>(`/v1/views/staff/receipts/orders/${id}`);
  const receipt = prepareThermalReceipt(data);
  const barcodeDataUrl = await receiptBarcode(receipt.receiptNumber);
  return <main className="thermal-receipt-page">
    <PrintReceiptButton orderId={data.order.id} basePath="/staff/receipts/orders" autoPrint={autoPrint}/>
    <ThermalReceipt {...receipt} barcodeDataUrl={barcodeDataUrl}/>
  </main>;
}
