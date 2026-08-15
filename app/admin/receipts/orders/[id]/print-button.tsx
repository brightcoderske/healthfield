"use client";

import { Download, Printer } from "lucide-react";

export function PrintReceiptButton({ orderId, basePath = "/admin/receipts/orders" }: { orderId: number; basePath?: string }) {
  return <div className="thermal-receipt-actions" aria-label="Receipt actions">
    <a href={`${basePath}/${orderId}/download`}><Download/> Download thermal PDF</a>
    <button type="button" onClick={() => window.print()}><Printer/> Print receipt</button>
  </div>;
}
