"use client";import{Printer}from"lucide-react";export function PrintReceiptButton(){return <button className="receipt-print" onClick={()=>window.print()}><Printer/> Print colour receipt</button>}
