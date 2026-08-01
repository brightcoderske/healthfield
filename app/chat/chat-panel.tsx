"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Message = { id: number; message: string; createdAt: string; firstName: string; role: string };

export function ChatPanel({ conversationId }: { conversationId?: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const participant = useMemo(() => conversationId ? messages.find(message => message.role === "CUSTOMER")?.firstName || "Customer" : "Healthfield pharmacy team", [conversationId, messages]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/chats${conversationId ? `?conversation=${conversationId}` : ""}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Chat could not be loaded. Sign in again and retry.");
      return;
    }
    setError("");
    setMessages(data.messages || []);
  }, [conversationId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError("");
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, conversationId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Message could not be sent.");
      setSending(false);
      return;
    }
    setText("");
    await load();
    setSending(false);
  }

  return (
    <main className="chat-page">
      <header>
        <a href={conversationId ? "/admin/chats" : "/account"}>← Back</a>
        <div>
          <h1>{participant}</h1>
          <p><span className="chat-online-dot"/> {conversationId ? "Customer conversation" : "Pharmacy support"}</p>
        </div>
      </header>
      <section>
        <div className="chat-messages">
          {messages.length ? messages.map((message) => (
            <article className={message.role === "CUSTOMER" ? "customer" : "team"} key={message.id}>
              <strong>{message.role === "CUSTOMER" ? message.firstName : "Healthfield team"}</strong>
              <p>{message.message}</p>
              <small>{new Date(message.createdAt).toLocaleString()}</small>
            </article>
          )) : (
            <div className="chat-empty">
              <strong>How can we help?</strong>
              <p>Send a message and our pharmacy team will reply here.</p>
            </div>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={submit}>
          <textarea aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} placeholder="Type your message…" rows={2} />
          <button disabled={sending}>{sending ? "Sending…" : "Send"}</button>
        </form>
      </section>
    </main>
  );
}
