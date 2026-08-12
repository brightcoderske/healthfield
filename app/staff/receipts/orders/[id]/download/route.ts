import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { ReceiptPdf, type ReceiptData } from "@/app/admin/receipts/orders/[id]/receipt-pdf";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";

export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){await requireStaffPermission("RECEIPTS_VIEW");const data=await backendJson<ReceiptData>(`/v1/views/staff/receipts/orders/${(await params).id}`),pdf=await renderToBuffer(createElement(ReceiptPdf,data) as Parameters<typeof renderToBuffer>[0]);return new Response(new Uint8Array(pdf),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${data.order.orderNumber}-receipt.pdf"`,"Cache-Control":"private, no-store"}})}
