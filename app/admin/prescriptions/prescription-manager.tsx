"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { useState } from "react";

type Item = { id:number; senderName:string|null; originalFilename:string; createdAt:string; status:string; mimeType:string; pharmacistNotes:string|null };
const statuses = ["RECEIVED", "UNDER_REVIEW", "APPROVED", "MORE_INFORMATION_REQUIRED", "DECLINED"];

export function PrescriptionManager({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [saving, setSaving] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState<Item | null>(null);
  async function update(item: Item, status: string, notes: string) {
    setSaving(item.id);
    const response = await fetch(`/api/prescriptions/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, pharmacistNotes: notes }) });
    if (response.ok) setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, status, pharmacistNotes: notes } : row));
    setSaving(null);
  }
  const fileUrl = previewing ? `/api/prescriptions/${previewing.id}/download` : "";
  return <>
    <section className="prescription-review-list" aria-label="Prescription review queue">
      <div className="prescription-review-head"><span>Sender</span><span>Prescription</span><span>Status</span><span>Pharmacist note</span><span>Action</span></div>
      {items.map((item) => <article key={item.id}>
        <div className="prescription-sender"><small>Sender</small><button type="button" onClick={() => setPreviewing(item)}>{item.senderName || "Customer"}</button></div>
        <div className="prescription-file"><small>Prescription</small><button type="button" onClick={() => setPreviewing(item)}><FileText /> <span>{item.originalFilename}</span><ExternalLink /></button><small>{new Date(item.createdAt).toLocaleString()} · {item.mimeType}</small></div>
        <label><span>Status</span><select defaultValue={item.status} id={`status-${item.id}`}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label><span>Pharmacist note</span><input id={`notes-${item.id}`} defaultValue={item.pharmacistNotes || ""} placeholder="Note to customer" /></label>
        <button className="prescription-update" disabled={saving === item.id} onClick={() => update(item, (document.getElementById(`status-${item.id}`) as HTMLSelectElement).value, (document.getElementById(`notes-${item.id}`) as HTMLInputElement).value)}>{saving === item.id ? "Saving…" : "Update"}</button>
      </article>)}
      {!items.length && <div className="prescription-empty"><FileText /><strong>No prescriptions awaiting review</strong><span>New uploads will appear here with the sender and file name.</span></div>}
    </section>
    {previewing && <div className="prescription-preview-modal" role="dialog" aria-modal="true" aria-label={`Prescription from ${previewing.senderName || "customer"}`} onClick={() => setPreviewing(null)}>
      <section onClick={(event) => event.stopPropagation()}>
        <header><div><small>Prescription from</small><h2>{previewing.senderName || "Customer"}</h2><p>{previewing.originalFilename}</p></div><button type="button" onClick={() => setPreviewing(null)} aria-label="Close prescription preview"><X /></button></header>
        <div className="prescription-preview-content">{previewing.mimeType.startsWith("image/") ? <img src={fileUrl} alt={`Prescription uploaded by ${previewing.senderName || "customer"}`} /> : <iframe src={fileUrl} title={previewing.originalFilename} />}</div>
        <footer><a href={fileUrl} target="_blank" rel="noreferrer">Open in a new tab <ExternalLink /></a></footer>
      </section>
    </div>}
  </>;
}
