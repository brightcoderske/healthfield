"use client";

import { ArrowLeft, Save, Settings } from "lucide-react";
import { FormEvent, useState } from "react";

type SettingsValue = {
  pharmacyName: string; phone: string | null; whatsapp: string | null;
  supportEmail: string | null; address: string | null; openingHours: string | null;
  deliveryMessage: string; freeDeliveryThreshold: string | null;
  bulkSmsApiUrl: string | null; bulkSmsApiKey: string | null; bulkSmsSenderId: string | null;
  facebookUrl:string|null; instagramUrl:string|null; xUrl:string|null; tiktokUrl:string|null;
} | null;

export function SettingsForm({ initial }: { initial: SettingsValue }) {
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    setMessage(response.ok ? "Settings saved." : data.error ?? "Unable to save settings.");
  }
  return (
    <main className="settings-page">
      <header><a href="/admin"><ArrowLeft /> Dashboard</a><div><Settings /><span><h1>Website settings</h1><p>Customer contact, delivery and SMS settings. Email uses the cPanel SMTP mailbox.</p></span></div></header>
      <form onSubmit={submit}>
        <section><h2>Pharmacy contact</h2><div>
          <label>Pharmacy name<input name="pharmacyName" defaultValue={initial?.pharmacyName ?? "Healthfield Pharmacy"} required /></label>
          <label>Phone number<input name="phone" defaultValue={initial?.phone ?? ""} placeholder="+254..." /></label>
          <label>WhatsApp number<input name="whatsapp" defaultValue={initial?.whatsapp ?? ""} placeholder="+254..." /></label>
          <label>Support email<input name="supportEmail" type="email" defaultValue={initial?.supportEmail ?? ""} /></label>
          <label className="full">Address<textarea name="address" rows={3} defaultValue={initial?.address ?? ""} /></label>
          <label className="full">Opening hours<input name="openingHours" defaultValue={initial?.openingHours ?? ""} placeholder="Mon–Sun, 8am–10pm" /></label>
        </div></section>
        <section><h2>Social media</h2><p>These links appear in the customer storefront footer.</p><div>
          <label>Facebook page<input name="facebookUrl" type="url" defaultValue={initial?.facebookUrl??""}/></label>
          <label>Instagram page<input name="instagramUrl" type="url" defaultValue={initial?.instagramUrl??""}/></label>
          <label>X / Twitter page<input name="xUrl" type="url" defaultValue={initial?.xUrl??""}/></label>
          <label>TikTok page<input name="tiktokUrl" type="url" defaultValue={initial?.tiktokUrl??""}/></label>
        </div></section>
        <section><h2>Delivery</h2><div>
          <label className="full">Header delivery message<input name="deliveryMessage" defaultValue={initial?.deliveryMessage ?? "Fast Delivery Across Kenya"} required /></label>
          <label>Free-delivery threshold (KES)<input name="freeDeliveryThreshold" type="number" min="0" defaultValue={initial?.freeDeliveryThreshold ?? ""} /></label>
        </div></section>
        <section><h2>Bulk SMS API</h2><p>Healthfield sends JSON containing recipients, message and senderId to this provider.</p><div>
          <label className="full">SMS API URL<input name="bulkSmsApiUrl" type="url" defaultValue={initial?.bulkSmsApiUrl ?? ""} placeholder="https://provider.example/api/messages" /></label>
          <label>API key<input name="bulkSmsApiKey" type="password" defaultValue={initial?.bulkSmsApiKey ?? ""} autoComplete="off" /></label>
          <label>Sender ID<input name="bulkSmsSenderId" defaultValue={initial?.bulkSmsSenderId ?? ""} placeholder="HEALTHFIELD" /></label>
        </div></section>
        {message && <div className="form-message">{message}</div>}
        <button><Save /> Save settings</button>
      </form>
    </main>
  );
}
