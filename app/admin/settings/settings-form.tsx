"use client";
/* eslint-disable react/no-unescaped-entities, @next/next/no-img-element -- local blob previews are not image-optimizer inputs */

import { ArrowLeft, Save, Settings } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";

type SettingsValue = {
  pharmacyName: string; phone: string | null; whatsapp: string | null;
  supportEmail: string | null; address: string | null; openingHours: string | null;
  deliveryMessage: string; freeDeliveryThreshold: string | null;
  bulkSmsApiUrl: string | null; bulkSmsApiKey: string | null; bulkSmsSenderId: string | null;
  facebookUrl:string|null; instagramUrl:string|null; xUrl:string|null; tiktokUrl:string|null;
  licenceTitle:string|null;licenceNumber:string|null;licenceImageUrl:string|null;
  requireTeamTwoFactor:boolean;
  onlineMpesaEnabled:boolean;onlineManualEnabled:boolean;posCashEnabled:boolean;posMpesaEnabled:boolean;posManualEnabled:boolean;
  mpesaTillNumber:string|null;mpesaAccountName:string|null;
} | null;

export function SettingsForm({ initial, paymentRuntime }: { initial: SettingsValue; paymentRuntime: { mpesaConfigured: boolean; stkQueryConfigured?:boolean; c2bCallbacksConfigured?:boolean; transactionStatusConfigured?:boolean; pullTransactionsConfigured?:boolean } }) {
  const [message, setMessage] = useState("");
  const [licenceFile,setLicenceFile]=useState<File|null>(null);
  const [licencePreview,setLicencePreview]=useState(initial?.licenceImageUrl??"");
  const [requireTeamTwoFactor,setRequireTeamTwoFactor]=useState(initial?.requireTeamTwoFactor??false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formData=new FormData(event.currentTarget);
    let licenceImageUrl=String(formData.get("licenceImageUrl")||"");
    if(licenceFile){const upload=new FormData();upload.set("image",licenceFile);const uploadResponse=await fetch("/api/products/image",{method:"POST",body:upload}),uploadData=await uploadResponse.json().catch(()=>({}));if(!uploadResponse.ok){setMessage(uploadData.error||"Licence image could not be uploaded.");return}licenceImageUrl=uploadData.imageUrl}
    formData.delete("licenceFile");
    const requireTeamTwoFactor=formData.has("requireTeamTwoFactor");
    formData.delete("requireTeamTwoFactor");
    const paymentFlags = Object.fromEntries(["onlineMpesaEnabled","onlineManualEnabled","posCashEnabled","posMpesaEnabled","posManualEnabled"].map((name)=>{const enabled=formData.has(name);formData.delete(name);return [name,enabled]}));
    const payload = {...Object.fromEntries(formData),...paymentFlags,licenceImageUrl,requireTeamTwoFactor};
    const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    setMessage(response.ok ? "Settings saved." : data.error ?? "Unable to save settings.");
  }
  return (
    <main className="settings-page">
      <header><a href="/admin"><ArrowLeft /> Dashboard</a><div><Settings /><span><h1>Website settings</h1></span></div></header>
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
        <section className="payment-settings"><h2>Payments</h2><p>Choose the methods offered online and at the walk-in till. Provider credentials and callbacks are managed in the production API environment and Daraja portal.</p><div className={`payment-runtime ${paymentRuntime.mpesaConfigured?"ready":"missing"}`}><strong>{paymentRuntime.mpesaConfigured?"M-Pesa Express and C2B ready":"M-Pesa credentials are missing"}</strong><small>{paymentRuntime.mpesaConfigured?`STK Query ready · Transaction Status ${paymentRuntime.transactionStatusConfigured?"ready":"needs environment values"} · Pull recovery ${paymentRuntime.pullTransactionsConfigured?"ready":"needs environment values"}`:"Add the required MPESA_* environment variables before enabling M-Pesa."}</small></div><div><label>M-Pesa till number<input name="mpesaTillNumber" inputMode="numeric" defaultValue={initial?.mpesaTillNumber??""} placeholder="e.g. 123456"/></label><label>Account or business name<input name="mpesaAccountName" defaultValue={initial?.mpesaAccountName??"Healthfield Pharmacy"}/></label></div><h3>Online checkout</h3><div className="payment-toggle-grid"><label><input name="onlineMpesaEnabled" type="checkbox" defaultChecked={initial?.onlineMpesaEnabled??true}/><span><strong>M-Pesa Express</strong><small>Send an STK prompt and verify automatically.</small></span></label><label><input name="onlineManualEnabled" type="checkbox" defaultChecked={initial?.onlineManualEnabled??true}/><span><strong>Manual M-Pesa</strong><small>Show the till and collect payment proof for approval.</small></span></label></div><h3>Walk-in checkout</h3><div className="payment-toggle-grid"><label><input name="posCashEnabled" type="checkbox" defaultChecked={initial?.posCashEnabled??true}/><span><strong>Cash</strong><small>Available only at the counter.</small></span></label><label><input name="posMpesaEnabled" type="checkbox" defaultChecked={initial?.posMpesaEnabled??true}/><span><strong>M-Pesa push</strong><small>Send an STK prompt from the teller screen.</small></span></label><label><input name="posManualEnabled" type="checkbox" defaultChecked={initial?.posManualEnabled??true}/><span><strong>Manual till</strong><small>Check the customer's till receipt automatically.</small></span></label></div></section>
        <section className="security-settings"><h2>Admin and staff security</h2><p>Control whether every administrator and staff login must be confirmed with a code sent by email.</p><label className="security-toggle"><input name="requireTeamTwoFactor" type="checkbox" checked={requireTeamTwoFactor} onChange={(event)=>setRequireTeamTwoFactor(event.target.checked)}/><span><strong>Require email 2FA for administrators and staff</strong><small>{requireTeamTwoFactor ? "Active: team members must enter an emailed code after their password." : "Inactive: team members sign in with their password only."}</small></span></label><p className="security-warning">Keep this inactive until security emails are reliably arriving. Suspended and deleted accounts remain blocked either way.</p></section>
        <section><h2>Pharmacy licence</h2><p>Upload the licence here. It is displayed prominently above the website footer.</p><div><label>Licence title<input name="licenceTitle" defaultValue={initial?.licenceTitle??"Pharmacy Licence"} required/></label><label>Licence number<input name="licenceNumber" defaultValue={initial?.licenceNumber??""} required/></label><input type="hidden" name="licenceImageUrl" value={initial?.licenceImageUrl??""}/><label className="full">Licence image<input name="licenceFile" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0]||null;if(file&&file.size>2*1024*1024){event.target.value="";setMessage("Licence image must be 2 MB or smaller.");return}setLicenceFile(file);if(file)setLicencePreview(URL.createObjectURL(file))}}/><small>JPEG, PNG or WebP, maximum 2 MB.</small></label>{licencePreview&&<div className="licence-admin-preview full"><img src={licencePreview} alt="Licence preview"/><button type="button" onClick={()=>{setLicenceFile(null);setLicencePreview("")}}>Remove licence image</button></div>}</div></section>
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
