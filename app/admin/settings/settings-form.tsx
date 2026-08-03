"use client";

import { ArrowLeft, Save, Settings } from "lucide-react";
import { ChangeEvent, FormEvent, useState } from "react";

type SettingsValue = {
  pharmacyName: string; phone: string | null; whatsapp: string | null;
  supportEmail: string | null; address: string | null; openingHours: string | null;
  deliveryMessage: string; freeDeliveryThreshold: string | null;
  bulkSmsApiUrl: string | null; bulkSmsApiKey: string | null; bulkSmsSenderId: string | null;
  facebookUrl:string|null; instagramUrl:string|null; xUrl:string|null; tiktokUrl:string|null;
  licenceTitle:string|null;licenceNumber:string|null;licenceImageUrl:string|null;
} | null;

export function SettingsForm({ initial }: { initial: SettingsValue }) {
  const [message, setMessage] = useState("");
  const [licenceFile,setLicenceFile]=useState<File|null>(null);
  const [licencePreview,setLicencePreview]=useState(initial?.licenceImageUrl??"");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formData=new FormData(event.currentTarget);
    let licenceImageUrl=String(formData.get("licenceImageUrl")||"");
    if(licenceFile){const upload=new FormData();upload.set("image",licenceFile);const uploadResponse=await fetch("/api/products/image",{method:"POST",body:upload}),uploadData=await uploadResponse.json().catch(()=>({}));if(!uploadResponse.ok){setMessage(uploadData.error||"Licence image could not be uploaded.");return}licenceImageUrl=uploadData.imageUrl}
    formData.delete("licenceFile");
    const payload = {...Object.fromEntries(formData),licenceImageUrl};
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
