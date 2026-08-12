import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { ReceiptPdf, type ReceiptData } from "@/app/admin/receipts/orders/[id]/receipt-pdf";
import { backendJson } from "@/lib/backend-api";

export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const data=await backendJson<ReceiptData>(`/v1/views/staff/orders/${(await params).id}`),pdf=await renderToBuffer(createElement(ReceiptPdf,data) as Parameters<typeof renderToBuffer>[0]);return new Response(new Uint8Array(pdf),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${data.order.orderNumber}-receipt.pdf"`,"Cache-Control":"private, no-store"}})}
