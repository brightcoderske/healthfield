"use client";

import { Mail, MessageSquareText, Search, Send } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

type Campaign = {
  id: number;
  name: string;
  channel: string;
  status: string;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  createdAt: Date;
};

export function CampaignManager({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [query,setQuery]=useState("");
  const shown=useMemo(()=>campaigns.filter(campaign=>`${campaign.name} ${campaign.channel} ${campaign.status}`.toLowerCase().includes(query.toLowerCase())),[campaigns,query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setMessage(response.ok ? `Campaign sent to ${data.successCount} customers.` : data.error || "Campaign could not be sent.");
    setSending(false);
    if (response.ok) {
      setCampaigns((current) => [{
        id: data.id,
        name: String(payload.name),
        channel: String(payload.channel),
        status: "SENT",
        recipientCount: data.recipientCount,
        successCount: data.successCount,
        failureCount: data.failureCount,
        createdAt: new Date(),
      }, ...current]);
      event.currentTarget.reset();
    }
  }

  return (
    <main className="campaign-page">
      <header><a href="/admin">← Dashboard</a><span><MessageSquareText /><div><h1>Customer campaigns</h1><p>Email and SMS registered Healthfield customers.</p></div></span></header>
      <div className="campaign-layout">
        <form onSubmit={submit}>
          <h2>Create campaign</h2>
          <label>Campaign name<input name="name" required maxLength={180} /></label>
          <label>Channel<select name="channel" defaultValue="EMAIL"><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="EMAIL_AND_SMS">Email and SMS</option></select></label>
          <label>Email subject<input name="subject" maxLength={220} /></label>
          <label>Message<textarea name="message" rows={8} required maxLength={3000} /></label>
          {message && <div className="form-message">{message}</div>}
          <button disabled={sending}><Send />{sending ? "Sending…" : "Send campaign"}</button>
        </form>
        <section>
          <h2>Campaign history</h2>
          <label className="campaign-search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search campaigns"/><span>{shown.length} records</span></label>
          {shown.length === 0 ? <div className="database-empty"><Mail /><strong>{query?"No matching campaigns":"No campaigns sent"}</strong></div> : <><div className="campaign-table-head"><span>Campaign</span><span>Status</span><span>Delivery</span></div>{shown.map((campaign) => (
            <article key={campaign.id}>
              <div><strong>{campaign.name}</strong><small>{campaign.channel.replaceAll("_", " ")} · {new Date(campaign.createdAt).toLocaleDateString()}</small></div>
              <span>{campaign.status}</span>
              <b>{campaign.successCount}/{campaign.recipientCount} sent</b>
            </article>
          ))}</>}
        </section>
      </div>
    </main>
  );
}
