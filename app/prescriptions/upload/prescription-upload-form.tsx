"use client";

import { FileCheck2, LockKeyhole, PackageCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

type LinkedItem = { id:number;name:string;packSize:string|null;quantity:number };

export function PrescriptionUploadForm({ linkedItems }: { linkedItems:LinkedItem[] }) {
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<number|null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const form = event.currentTarget;
    const payload = new FormData(form);
    const file = payload.get("prescription");
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024) return setMessage("Choose a PDF, PNG or JPG file no larger than 2 MB.");
    payload.set("items", JSON.stringify(linkedItems.map((item) => ({ productId:item.id,quantity:item.quantity }))));
    setUploading(true); setMessage("");
    try {
      const response = await fetch("/api/prescriptions", { method:"POST",body:payload });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage(data.error || "Upload failed.");
      if (linkedItems.length) {
        const cartResponse = await fetch("/api/cart", { method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({productIds:linkedItems.map((item)=>item.id)}) });
        if (!cartResponse.ok) setMessage("Prescription received, but the linked medicines could not be removed from your shopping cart. They remain safely linked to the request; remove the duplicate cart lines before normal checkout.");
        else setMessage(`${linkedItems.length} ${linkedItems.length===1?"medicine":"medicines"} linked. Their final quantities and prices are pending pharmacist confirmation.`);
      } else setMessage("Prescription received. A pharmacist will identify, check and price the required medicines.");
      setRequestId(Number(data.id)); form.reset();
    } catch { setMessage("Upload could not reach the server. Please try again."); }
    finally { setUploading(false); }
  }

  return <main className="prescription-upload-page">
    <form onSubmit={submit}>
      <Link href="/">← Continue shopping</Link>
      <Upload />
      <span className="auth-kicker">Prescription request</span>
      <h1>Send for pharmacist review</h1>
      <p>Upload a clear PDF, PNG, JPG or JPEG file. Maximum size: 2 MB.</p>
      {linkedItems.length ? <section className="prescription-upload-linked">
        <header><PackageCheck/><span><strong>Linked from your cart</strong><small>These lines leave your normal cart and wait for pharmacist pricing.</small></span></header>
        {linkedItems.map((item)=><article key={item.id}><span><strong>{item.name}</strong><small>{item.packSize||"Prescription medicine"} · Requested qty {item.quantity}</small></span><em><LockKeyhole/>Price pending</em></article>)}
      </section> : <aside className="prescription-upload-empty"><PackageCheck/><span><strong>No medicines linked</strong><small>That is okay—the pharmacist will identify and add the prescribed products.</small></span></aside>}
      <label><span>Select prescription</span><input name="prescription" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required /></label>
      {message ? <div className="form-message" role="status"><FileCheck2 /> {message}</div> : null}
      {requestId ? <div className="prescription-upload-next"><Link href={`/account/prescriptions/${requestId}`}>Track this request</Link><Link href="/cart">Return to normal cart</Link></div> : null}
      <button disabled={uploading}>{uploading ? "Uploading…" : "Send for review"}</button>
    </form>
  </main>;
}
