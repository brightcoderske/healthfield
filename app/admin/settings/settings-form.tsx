"use client";
/* eslint-disable react/no-unescaped-entities, @next/next/no-img-element -- local blob previews are not image-optimizer inputs */

import { ArrowLeft, Banknote, BadgeCheck, Check, Loader, Save, Settings, Share2, ShieldCheck, Store, Truck } from "lucide-react";
import { ChangeEvent, FormEvent, ReactNode, useState } from "react";

type SettingsValue = {
  pharmacyName: string; phone: string | null; whatsapp: string | null;
  supportEmail: string | null; address: string | null; openingHours: string | null;
  deliveryMessage: string; freeDeliveryThreshold: string | null;
  facebookUrl:string|null; instagramUrl:string|null; xUrl:string|null; tiktokUrl:string|null;
  licenceTitle:string|null;licenceNumber:string|null;licenceImageUrl:string|null;
  requireTeamTwoFactor:boolean;
  onlineMpesaEnabled:boolean;onlineManualEnabled:boolean;onlineCodEnabled:boolean;posCashEnabled:boolean;posMpesaEnabled:boolean;posManualEnabled:boolean;
  mpesaTillNumber:string|null;mpesaAccountName:string|null;
} | null;

/** Section identities. The accent colour is per section, so the page reads as parts. */
type SectionKey = "contact" | "social" | "delivery" | "payments" | "security" | "licence";

/**
 * One settings section: its own form, its own save, its own state.
 *
 * The page used to be a single form behind one button, so changing a phone number meant
 * re-submitting the payment toggles and the licence too. Each section now sends only
 * its own fields, and the API leaves everything it was not sent untouched.
 */
function Section({
  id, title, description, icon, children, onSave, tone,
}: {
  id: SectionKey;
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
  tone: string;
  onSave: (form: FormData) => Promise<string | null>;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setError("");
    try {
      const problem = await onSave(new FormData(event.currentTarget));
      if (problem) {
        setError(problem);
        setState("idle");
        return;
      }
      setState("saved");
      // Long enough to be read, short enough not to look like a permanent state.
      window.setTimeout(() => setState("idle"), 2400);
    } catch {
      setError("Unable to save. Check your connection and try again.");
      setState("idle");
    }
  }

  return (
    <form className={`settings-section settings-${id}`} style={{ ["--section-tone" as string]: tone }} onSubmit={submit}>
      <header className="settings-section-head">
        <span className="settings-section-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <button disabled={state === "saving"}>
          {state === "saving" ? <Loader className="spin" /> : state === "saved" ? <Check /> : <Save />}
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save"}
        </button>
      </header>
      <span className="settings-section-rule" aria-hidden="true" />
      <div className="settings-section-body">{children}</div>
      {error ? <div className="settings-section-error" role="alert">{error}</div> : null}
    </form>
  );
}

async function putSettings(payload: Record<string, unknown>) {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? null : (data.error ?? "Unable to save settings.");
}

/**
 * Checkboxes are absent from FormData when unchecked, so each section states which of
 * its fields are booleans and sends an explicit true or false for them. Without this an
 * unticked box would simply not be sent, and a partial save would read as "unchanged".
 */
function withBooleans(form: FormData, names: string[]) {
  const payload = Object.fromEntries(form) as Record<string, unknown>;
  for (const name of names) payload[name] = form.has(name);
  return payload;
}

export function SettingsForm({ initial, paymentRuntime }: { initial: SettingsValue; paymentRuntime: { mpesaConfigured: boolean; stkQueryConfigured?:boolean; c2bCallbacksConfigured?:boolean; transactionStatusConfigured?:boolean; pullTransactionsConfigured?:boolean } }) {
  const [licenceFile,setLicenceFile]=useState<File|null>(null);
  const [licencePreview,setLicencePreview]=useState(initial?.licenceImageUrl??"");
  const [licenceNote,setLicenceNote]=useState("");
  const [requireTeamTwoFactor,setRequireTeamTwoFactor]=useState(initial?.requireTeamTwoFactor??false);

  return (
    <main className="settings-page sectioned-settings">
      <header><a href="/admin"><ArrowLeft /> Dashboard</a><div><Settings /><span><h1>Website settings</h1></span></div></header>
      <p className="settings-intro">Each group saves on its own, so a change here never resubmits anything there.</p>

      <Section
        id="contact" tone="#762584" icon={<Store />}
        title="Pharmacy contact"
        description="Shown across the storefront and on receipts."
        onSave={(form) => putSettings(Object.fromEntries(form))}
      >
        <div className="settings-grid">
          <label>Pharmacy name<input name="pharmacyName" defaultValue={initial?.pharmacyName ?? "Healthfield Pharmacy"} required /></label>
          <label>Phone number<input name="phone" defaultValue={initial?.phone ?? ""} placeholder="+254..." /></label>
          <label>WhatsApp number<input name="whatsapp" defaultValue={initial?.whatsapp ?? ""} placeholder="+254..." /></label>
          <label>Support email<input name="supportEmail" type="email" defaultValue={initial?.supportEmail ?? ""} /></label>
          <label className="full">Address<textarea name="address" rows={3} defaultValue={initial?.address ?? ""} /></label>
          <label className="full">Opening hours<input name="openingHours" defaultValue={initial?.openingHours ?? ""} placeholder="Mon–Sun, 8am–10pm" /></label>
        </div>
      </Section>

      <Section
        id="social" tone="#1d6fd0" icon={<Share2 />}
        title="Social media"
        description="These links appear in the customer storefront footer."
        onSave={(form) => putSettings(Object.fromEntries(form))}
      >
        <div className="settings-grid">
          <label>Facebook page<input name="facebookUrl" type="url" defaultValue={initial?.facebookUrl??""}/></label>
          <label>Instagram page<input name="instagramUrl" type="url" defaultValue={initial?.instagramUrl??""}/></label>
          <label>X / Twitter page<input name="xUrl" type="url" defaultValue={initial?.xUrl??""}/></label>
          <label>TikTok page<input name="tiktokUrl" type="url" defaultValue={initial?.tiktokUrl??""}/></label>
        </div>
      </Section>

      <Section
        id="delivery" tone="#19954a" icon={<Truck />}
        title="Delivery"
        description="Distance bands and fees live on the Delivery pricing screen."
        onSave={(form) => putSettings(Object.fromEntries(form))}
      >
        <div className="settings-grid">
          <label className="full">Header delivery message<input name="deliveryMessage" defaultValue={initial?.deliveryMessage ?? "Fast Delivery Across Kenya"} required /></label>
          <label>Free-delivery threshold (KES)<input name="freeDeliveryThreshold" type="number" min="0" defaultValue={initial?.freeDeliveryThreshold ?? ""} /></label>
        </div>
      </Section>

      <Section
        id="payments" tone="#d92f91" icon={<Banknote />}
        title="Payments"
        description="Methods offered online and at the walk-in till. Provider credentials live in the API environment."
        onSave={(form) => putSettings(withBooleans(form, ["onlineMpesaEnabled","onlineManualEnabled","onlineCodEnabled","posCashEnabled","posMpesaEnabled","posManualEnabled"]))}
      >
        <div className={`payment-runtime ${paymentRuntime.mpesaConfigured?"ready":"missing"}`}>
          <strong>{paymentRuntime.mpesaConfigured?"M-Pesa Express and C2B ready":"M-Pesa credentials are missing"}</strong>
          <small>{paymentRuntime.mpesaConfigured?`STK Query ready · Transaction Status ${paymentRuntime.transactionStatusConfigured?"ready":"needs environment values"} · Pull recovery ${paymentRuntime.pullTransactionsConfigured?"ready":"needs environment values"}`:"Add the required MPESA_* environment variables before enabling M-Pesa."}</small>
        </div>
        <div className="settings-grid">
          <label>M-Pesa till number<input name="mpesaTillNumber" inputMode="numeric" defaultValue={initial?.mpesaTillNumber??""} placeholder="e.g. 123456"/></label>
          <label>Account or business name<input name="mpesaAccountName" defaultValue={initial?.mpesaAccountName??"Healthfield Pharmacy"}/></label>
        </div>
        <h3>Online checkout</h3>
        <div className="payment-toggle-grid">
          <label><input name="onlineMpesaEnabled" type="checkbox" defaultChecked={initial?.onlineMpesaEnabled??true}/><span><strong>M-Pesa Express</strong><small>Send an STK prompt and verify automatically.</small></span></label>
          <label><input name="onlineManualEnabled" type="checkbox" defaultChecked={initial?.onlineManualEnabled??true}/><span><strong>Manual M-Pesa</strong><small>Show the till and collect payment proof for approval.</small></span></label>
          <label><input name="onlineCodEnabled" type="checkbox" defaultChecked={initial?.onlineCodEnabled??false}/><span><strong>Cash on delivery</strong><small>Delivery orders only. The customer gets an invoice and the rider collects on arrival.</small></span></label>
        </div>
        <h3>Walk-in checkout</h3>
        <div className="payment-toggle-grid">
          <label><input name="posCashEnabled" type="checkbox" defaultChecked={initial?.posCashEnabled??true}/><span><strong>Cash</strong><small>Available only at the counter.</small></span></label>
          <label><input name="posMpesaEnabled" type="checkbox" defaultChecked={initial?.posMpesaEnabled??true}/><span><strong>M-Pesa push</strong><small>Send an STK prompt from the teller screen.</small></span></label>
          <label><input name="posManualEnabled" type="checkbox" defaultChecked={initial?.posManualEnabled??true}/><span><strong>Manual till</strong><small>Check the customer's till receipt automatically.</small></span></label>
        </div>
      </Section>

      <Section
        id="security" tone="#89521d" icon={<ShieldCheck />}
        title="Admin and staff security"
        description="Whether every administrator and staff login must be confirmed with an emailed code."
        onSave={() => putSettings({ requireTeamTwoFactor })}
      >
        <label className="security-toggle">
          <input type="checkbox" checked={requireTeamTwoFactor} onChange={(event)=>setRequireTeamTwoFactor(event.target.checked)}/>
          <span>
            <strong>Require email 2FA for administrators and staff</strong>
            <small>{requireTeamTwoFactor ? "Active: team members must enter an emailed code after their password." : "Inactive: team members sign in with their password only."}</small>
          </span>
        </label>
        <p className="security-warning">Keep this inactive until security emails are reliably arriving. Suspended and deleted accounts remain blocked either way.</p>
      </Section>

      <Section
        id="licence" tone="#0f7f86" icon={<BadgeCheck />}
        title="Pharmacy licence"
        description="Displayed prominently above the website footer."
        onSave={async (form) => {
          const payload = Object.fromEntries(form) as Record<string, unknown>;
          delete payload.licenceFile;
          // The image is uploaded first: a saved licence row pointing at a file that
          // never arrived would show a broken licence on the public site.
          if (licenceFile) {
            const upload = new FormData();
            upload.set("image", licenceFile);
            const uploadResponse = await fetch("/api/products/image", { method: "POST", body: upload });
            const uploadData = await uploadResponse.json().catch(() => ({}));
            if (!uploadResponse.ok) return uploadData.error || "Licence image could not be uploaded.";
            payload.licenceImageUrl = uploadData.imageUrl;
          }
          return putSettings(payload);
        }}
      >
        <div className="settings-grid">
          <label>Licence title<input name="licenceTitle" defaultValue={initial?.licenceTitle??"Pharmacy Licence"} required/></label>
          <label>Licence number<input name="licenceNumber" defaultValue={initial?.licenceNumber??""} required/></label>
          <input type="hidden" name="licenceImageUrl" value={licencePreview.startsWith("blob:") ? (initial?.licenceImageUrl??"") : licencePreview}/>
          <label className="full">Licence image
            <input name="licenceFile" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event:ChangeEvent<HTMLInputElement>)=>{
              const file=event.target.files?.[0]||null;
              if(file&&file.size>2*1024*1024){event.target.value="";setLicenceNote("Licence image must be 2 MB or smaller.");return}
              setLicenceNote("");
              setLicenceFile(file);
              if(file)setLicencePreview(URL.createObjectURL(file));
            }}/>
            <small>JPEG, PNG or WebP, maximum 2 MB.</small>
          </label>
          {licenceNote ? <p className="settings-section-error full">{licenceNote}</p> : null}
          {licencePreview&&<div className="licence-admin-preview full"><img src={licencePreview} alt="Licence preview"/><button type="button" onClick={()=>{setLicenceFile(null);setLicencePreview("")}}>Remove licence image</button></div>}
        </div>
      </Section>
    </main>
  );
}
