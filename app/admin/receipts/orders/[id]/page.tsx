import { backendJson } from "@/lib/backend-api";
import { PrintReceiptButton } from "./print-button";
import { receiptBarcode } from "./receipt-assets";
import { prepareThermalReceipt, type ReceiptApiData } from "./thermal-receipt-data";
import { ThermalReceipt } from "./thermal-receipt";

export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autoPrint?: string }> }) {
  const id = Number((await params).id);
  const autoPrint = (await searchParams).autoPrint === "1";
  const data = await backendJson<ReceiptApiData>(`/v1/views/admin/orders/${id}`);
  const receipt = prepareThermalReceipt(data);
  const barcodeDataUrl = await receiptBarcode(receipt.receiptNumber);
  return <main className="thermal-receipt-page">
    <PrintReceiptButton orderId={data.order.id} autoPrint={autoPrint}/>
    <ThermalReceipt {...receipt} barcodeDataUrl={barcodeDataUrl}/>
  </main>;
}
