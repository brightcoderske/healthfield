"use client";
import { Download, Printer } from "lucide-react";
export function PrintReceiptButton({orderId,basePath="/admin/receipts/orders"}:{orderId:number;basePath?:string}){return <div className="receipt-actions"><a href={`${basePath}/${orderId}/download`}><Download/> Download A4 PDF</a><button className="receipt-print" onClick={()=>window.print()}><Printer/> Print receipt</button></div>}
