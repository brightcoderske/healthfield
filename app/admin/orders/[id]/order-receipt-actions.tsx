"use client";

import { Download, Printer } from "lucide-react";

export function OrderReceiptActions({ orderId }: { orderId: number }) {
  return <nav className="order-receipt-actions" aria-label="Receipt actions">
    <a href={`/admin/receipts/orders/${orderId}/download`}><Download /> Download receipt</a>
    <a href={`/admin/receipts/orders/${orderId}`} target="_blank" rel="noreferrer"><Printer /> Print receipt</a>
  </nav>;
}
