"use client";

import { AlertCircle, Paperclip, SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

const accepted = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/avif", "image/tiff"];

export function ConsultationReply({ consultationId }: { consultationId: number }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (!message.trim()) return setError("Write a message before sending.");
    // Mirrors the server-side limits so an obvious mistake is caught before upload.
    if (file && (file.size > 10 * 1024 * 1024 || !accepted.includes(file.type)))
      return setError("Attachments must be a PDF, JPG, PNG, WebP, AVIF or TIFF file no larger than 10 MB.");

    setSending(true);
    setError("");
    try {
      const payload = new FormData();
      payload.set("message", message.trim());
      if (file) payload.set("attachment", file);
      const response = await fetch(`/api/consultations/${consultationId}/messages`, { method: "POST", body: payload });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The message could not be sent.");
      setMessage("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch {
      setError("The message could not reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="rx-reply" onSubmit={submit}>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={4000}
        placeholder="Add more detail, answer a question, or ask about your consultation."
        aria-label="Reply to your consultation"
      />
      <div className="rx-reply-actions">
        <label className="rx-reply-file">
          <Paperclip /> {file ? file.name.slice(0, 28) : "Attach a photo or document"}
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.avif,.tif,.tiff,application/pdf,image/png,image/jpeg,image/webp,image/avif,image/tiff"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <button disabled={sending}>
          <SendHorizontal /> {sending ? "Sending…" : "Send"}
        </button>
      </div>
      {error ? (
        <div className="rx-consult-message is-error" role="status">
          <AlertCircle /> {error}
        </div>
      ) : null}
    </form>
  );
}
