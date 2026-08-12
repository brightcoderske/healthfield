"use client";

import { Download, Printer } from "lucide-react";

export function OrderReceiptActions({ orderId, basePath="/admin/receipts/orders" }: { orderId: number; basePath?:string }) {
  return <nav className="order-receipt-actions" aria-label="Receipt actions">
    <a href={`${basePath}/${orderId}/download`}><Download /> Download receipt</a>
    <a href={`${basePath}/${orderId}`} target="_blank" rel="noreferrer"><Printer /> Print receipt</a>
  </nav>;
}
