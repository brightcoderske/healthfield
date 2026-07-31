"use client";

import { FileCheck2, Upload } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export function PrescriptionUploadForm() {
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setMessage("");
    const tokenResponse = await fetch("/api/auth/upload-token", { method: "POST" });
    const uploadSession = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      setMessage(uploadSession.error || "Upload could not be authorised.");
      setUploading(false);
      return;
    }
    const response = await fetch(`${uploadSession.apiUrl}/v1/prescriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${uploadSession.token}` },
      body: new FormData(event.currentTarget),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Prescription received for pharmacist review." : data.error || "Upload failed.");
    if (response.ok) event.currentTarget.reset();
    setUploading(false);
  }

  return (
    <main className="prescription-upload-page">
      <form onSubmit={submit}>
        <Link href="/">← Continue shopping</Link>
        <Upload />
        <h1>Upload prescription</h1>
        <p>Upload a clear PDF, PNG, JPG or JPEG file. Maximum size: 10 MB.</p>
        <label>
          <span>Select prescription</span>
          <input name="prescription" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required />
        </label>
        {message && <div className="form-message"><FileCheck2 /> {message}</div>}
        <button disabled={uploading}>{uploading ? "Uploading…" : "Send for review"}</button>
      </form>
    </main>
  );
}
