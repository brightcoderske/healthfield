"use client";

import { Download, Printer } from "lucide-react";
import { useEffect, useRef } from "react";

export function PrintReceiptButton({ orderId, basePath = "/admin/receipts/orders", autoPrint = false }: { orderId: number; basePath?: string; autoPrint?: boolean }) {
  const printed = useRef(false);
  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);
  return <div className="thermal-receipt-actions" aria-label="Receipt actions">
    <a href={`${basePath}/${orderId}/download`}><Download/> Download thermal PDF</a>
    <button type="button" onClick={() => window.print()}><Printer/> Print receipt</button>
  </div>;
}
