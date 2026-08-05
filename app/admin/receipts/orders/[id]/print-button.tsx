"use client";
import { Download, Printer } from "lucide-react";
export function PrintReceiptButton({orderId}:{orderId:number}){return <div className="receipt-actions"><a href={`/admin/receipts/orders/${orderId}/download`}><Download/> Download A4 PDF</a><button className="receipt-print" onClick={()=>window.print()}><Printer/> Print receipt</button></div>}
