"use client";

import { FileCheck2, Upload } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export function PrescriptionUploadForm() {
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(uploading)return;
    const form=event.currentTarget,file=new FormData(form).get("prescription");
    if(!(file instanceof File)||file.size>2*1024*1024){setMessage("Choose a PDF, PNG or JPG file no larger than 2 MB.");return}
    setUploading(true);
    setMessage("");
    try{const response=await fetch("/api/prescriptions",{method:"POST",body:new FormData(form)}),data=await response.json().catch(()=>({}));setMessage(response.ok?"Prescription received. Track its review from your account.":data.error||"Upload failed.");if(response.ok)form.reset()}catch{setMessage("Upload could not reach the server. Please try again.")}finally{setUploading(false)}
  }

  return (
    <main className="prescription-upload-page">
      <form onSubmit={submit}>
        <Link href="/">← Continue shopping</Link>
        <Upload />
        <h1>Upload prescription</h1>
        <p>Upload a clear PDF, PNG, JPG or JPEG file. Maximum size: 2 MB.</p>
        <label>
          <span>Select prescription</span>
          <input name="prescription" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required />
        </label>
        {message && <div className="form-message"><FileCheck2 /> {message}</div>}
        {message.startsWith("Prescription received")&&<Link href="/account#prescriptions">Track prescription status</Link>}
        <button disabled={uploading}>{uploading ? "Uploading…" : "Send for review"}</button>
      </form>
    </main>
  );
}
