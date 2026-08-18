"use client";

import { ArrowLeft, Check, CheckCircle2, Clipboard, CreditCard, LoaderCircle, LockKeyhole, MapPin, ReceiptText, ShoppingBag, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { paymentPollDelay } from "@/lib/payment-poll";
import { MapPicker, type PinnedLocation } from "../../../../map-picker";
import { useDeliveryQuote } from "../../../../use-delivery-quote";
import type { CustomerPrescriptionData } from "../../types";

type PaymentMethod="MPESA_EXPRESS"|"MANUAL_MPESA";
type CheckoutResult={id:number;orderNumber:string;total:number;state:"WAITING"|"REVIEW"|"PAID"|"FAILED";message:string};

export function PrescriptionCheckoutForm({prescriptionId,data}:{prescriptionId:number;data:CustomerPrescriptionData}){
  const {request,items,order,customer,payment}=data;
  const [fulfilment,setFulfilment]=useState<"DELIVERY"|"PICKUP">("DELIVERY");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod>(payment.onlineMpesaEnabled?"MPESA_EXPRESS":"MANUAL_MPESA");
  const [manualMessage,setManualMessage]=useState(""),[error,setError]=useState(""),[submitting,setSubmitting]=useState(false),[copied,setCopied]=useState(false);
  // The prompt goes to the number typed above unless the patient says otherwise.
  const [phone,setPhone]=useState(customer.phone||""),[billingPhone,setBillingPhone]=useState(customer.phone||""),[billingPhoneTouched,setBillingPhoneTouched]=useState(false);
  const [pin,setPin]=useState<PinnedLocation|null>(null),[address,setAddress]=useState(""),[addressTouched,setAddressTouched]=useState(false),[result,setResult]=useState<CheckoutResult|null>(null);
  const checkoutToken=useRef(globalThis.crypto.randomUUID()),pollCount=useRef(0);
  const proposalItems=items.filter((item)=>item.availability!=="UNAVAILABLE"&&item.approvedQuantity&&item.unitPrice);
  const subtotal=Number(order!.subtotal);
  // The frozen proposal is priced by the pharmacist; only the delivery leg is quoted here.
  const quotedLines=proposalItems.flatMap((item)=>item.productId?[{productId:item.productId,quantity:Number(item.approvedQuantity)}]:[]);
  const {quote:deliveryQuote,loading:quotingDelivery}=useDeliveryQuote({active:fulfilment==="DELIVERY",pin,subtotal,items:quotedLines});
  const deliveryBlocked=fulfilment==="DELIVERY"&&Boolean(deliveryQuote&&!deliveryQuote.available);
  const deliveryFee=fulfilment==="DELIVERY"&&deliveryQuote?.available?deliveryQuote.fee:0;
  const total=subtotal+deliveryFee;
  const noPayments=!payment.onlineMpesaEnabled&&!payment.onlineManualEnabled;
  // Seeded alongside the pin rather than in an effect, and never over anything typed.
  function pinLocation(location:PinnedLocation|null){setPin(location);if(location?.address&&!addressTouched)setAddress(location.address)}

  useEffect(()=>{
    if(result?.state!=="WAITING")return;
    let cancelled=false;
    async function check(){
      pollCount.current+=1;
      const response=await fetch("/api/payments/reconcile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutToken:checkoutToken.current})}).catch(()=>null);
      if(!response||cancelled)return;
      const payload=await response.json().catch(()=>({}));
      if(payload.paid||payload.order?.paymentStatus==="PAID")setResult((current)=>current?{...current,state:"PAID",message:`M-Pesa payment confirmed${payload.order?.paymentReference?` · Receipt ${payload.order.paymentReference}`:""}.`}:current);
      else if(payload.failed||payload.order?.paymentStatus==="FAILED")setResult((current)=>current?{...current,state:"FAILED",message:payload.message||payload.payment?.resultDescription||"The M-Pesa payment was not completed."}:current);
      else if(pollCount.current===24)setResult((current)=>current?{...current,message:"Safaricom has not returned a final result yet. Healthfield is still checking; do not pay a second time."}:current);
    }
    let timer=0;function schedule(){if(cancelled)return;timer=window.setTimeout(()=>void check().finally(schedule),paymentPollDelay(pollCount.current))}
    void check().finally(schedule);return()=>{cancelled=true;window.clearTimeout(timer)};
  },[result?.state]);

  async function copyTill(){
    if(!payment.tillNumber)return;
    try{await navigator.clipboard.writeText(payment.tillNumber);setCopied(true);window.setTimeout(()=>setCopied(false),2000)}catch{setError(`Copy the till number manually: ${payment.tillNumber}`)}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(submitting||result)return;
    const form=new FormData(event.currentTarget),value=(name:string)=>String(form.get(name)||"").trim();
    // No pin, no distance, no fee: delivery cannot be priced without one.
    if(fulfilment==="DELIVERY"&&!pin){setError("Pin your delivery location on the map so the delivery fee can be calculated.");return}
    if(deliveryBlocked){setError("Delivery is not available to that location. Choose pharmacy pickup or pin a location inside the delivery area.");return}
    setSubmitting(true);setError("");
    try{
      const response=await fetch(`/api/prescriptions/${prescriptionId}/checkout`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutToken:checkoutToken.current,fulfilmentMethod:fulfilment,paymentMethod,phone:value("phone"),billingPhone:paymentMethod==="MPESA_EXPRESS"?value("billingPhone"):undefined,manualPaymentMessage:paymentMethod==="MANUAL_MPESA"?manualMessage.trim():undefined,deliveryAddress:fulfilment==="DELIVERY"?value("deliveryAddress"):undefined,deliveryArea:fulfilment==="DELIVERY"?value("deliveryArea"):undefined,deliveryLatitude:pin?.latitude,deliveryLongitude:pin?.longitude})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){setError(payload.error||"Unable to start prescription checkout.");return}
      const state=payload.paymentStatus==="PAID"?"PAID":paymentMethod==="MANUAL_MPESA"?"REVIEW":payload.paymentStatus==="FAILED"?"FAILED":"WAITING";
      setResult({id:payload.id,orderNumber:payload.orderNumber,total:Number(payload.total),state,message:payload.paymentMessage||"Payment request started."});
    }catch{setError("Unable to reach checkout. Please try again.")}finally{setSubmitting(false)}
  }

  const tillPanel=payment.onlineManualEnabled?<div className="manual-payment-panel"><div><span>Pay to M-Pesa Till</span><strong>{payment.tillNumber}</strong><small>{payment.accountName||"Healthfield Pharmacy"}</small></div><button type="button" onClick={copyTill}>{copied?<Check/>:<Clipboard/>}{copied?"Copied":"Copy till"}</button><p>Exact amount: <strong>KES {total.toLocaleString()}</strong></p><p className="manual-payment-hint">Pay that exact amount to the till, then paste the confirmation message Safaricom sends you. The code inside it is what links your payment to this prescription.</p><label>Paste the complete M-Pesa confirmation message<textarea value={manualMessage} onChange={(event)=>setManualMessage(event.target.value)} rows={4} placeholder="Paste the message showing the transaction code, amount and till payment" required/></label></div>:null;

  if(result)return <main className={`checkout-success payment-result payment-${result.state.toLowerCase()} prescription-payment-result`}>{result.state==="WAITING"?<LoaderCircle className="spin"/>:result.state==="FAILED"?<ReceiptText/>:<CheckCircle2/>}<span>{result.orderNumber}</span><h1>{result.state==="PAID"?"Payment confirmed":result.state==="REVIEW"?"Payment proof received":result.state==="WAITING"?"Approve payment on your phone":"Payment not completed"}</h1><p>{result.message}</p><strong>KES {result.total.toLocaleString()}</strong><small>Your ordinary shopping cart was not changed.</small><div><Link href={`/account/prescriptions/${prescriptionId}`}>Back to prescription</Link><Link href="/#products"><ShoppingBag/> Continue shopping</Link></div></main>;

  return <main className="checkout-page prescription-checkout-page"><header><Link href={`/account/prescriptions/${prescriptionId}`}><ArrowLeft/> Proposal</Link><strong><LockKeyhole/> Secure prescription checkout</strong><Link href="/#products">Keep shopping</Link></header><div className="checkout-layout"><form onSubmit={submit}><span className="auth-kicker">Frozen pharmacy proposal</span><h1>Delivery and payment</h1><p className="prescription-checkout-note">The pharmacist-selected products below are locked. This checkout is separate from your normal cart.</p><div className="checkout-methods"><button type="button" className={fulfilment==="DELIVERY"?"active":""} onClick={()=>setFulfilment("DELIVERY")}><MapPin/> Home delivery</button><button type="button" className={fulfilment==="PICKUP"?"active":""} onClick={()=>setFulfilment("PICKUP")}><ShoppingBag/> Pharmacy pickup</button></div><div className="checkout-fields"><label>Customer<input value={`${customer.firstName} ${customer.lastName}`} disabled/></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" value={phone} onChange={event=>{setPhone(event.target.value);if(!billingPhoneTouched)setBillingPhone(event.target.value)}} required/></label>{fulfilment==="DELIVERY"?<><label>Town or area<input name="deliveryArea" required/></label><div className="checkout-location full"><span className="checkout-location-title"><MapPin/> Pin your delivery location</span><p className="checkout-location-note">The delivery fee is worked out from how far this pin is from the branch dispensing your prescription.</p><MapPicker value={pin} onChange={pinLocation}/><label className="full">Delivery address<textarea name="deliveryAddress" rows={3} required value={address} onChange={event=>{setAddressTouched(true);setAddress(event.target.value)}} placeholder="House or building name, floor, anything that helps the rider find you"/></label>{deliveryQuote&&!deliveryQuote.available?<div className="auth-error" role="alert">{deliveryQuote.message} Choose pharmacy pickup, or pin a location inside the delivery area.</div>:null}{deliveryQuote?.available&&deliveryQuote.courier?<p className="checkout-location-courier">Delivered by {deliveryQuote.courier} on Healthfield&rsquo;s behalf.</p>:null}</div></>:null}</div><h2>Payment method</h2><div className="payment-options">{payment.onlineMpesaEnabled?<label className={`payment-choice ${paymentMethod==="MPESA_EXPRESS"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MPESA_EXPRESS" checked={paymentMethod==="MPESA_EXPRESS"} onChange={()=>setPaymentMethod("MPESA_EXPRESS")}/><Smartphone/><span><strong>M-Pesa Express</strong><small>Receive a secure prompt on your phone</small></span></label>:null}{payment.onlineManualEnabled?<label className={`payment-choice ${paymentMethod==="MANUAL_MPESA"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MANUAL_MPESA" checked={paymentMethod==="MANUAL_MPESA"} onChange={()=>setPaymentMethod("MANUAL_MPESA")}/><CreditCard/><span><strong>Manual M-Pesa</strong><small>Pay to the till and submit the confirmation</small></span></label>:null}</div>{paymentMethod==="MPESA_EXPRESS"&&payment.onlineMpesaEnabled?<label className="billing-phone">Phone to receive the prompt<input name="billingPhone" type="tel" value={billingPhone} onChange={event=>{setBillingPhoneTouched(true);setBillingPhone(event.target.value)}} required/><small>Taken from the number above. Change it to pay from another phone.</small></label>:null}{paymentMethod==="MANUAL_MPESA"?tillPanel:null}{noPayments?<div className="auth-error" role="alert">Online payment is temporarily unavailable. Your proposal remains saved.</div>:null}{error?<div className="auth-error" role="alert">{error}</div>:null}<button className="place-order" disabled={submitting||noPayments||(paymentMethod==="MANUAL_MPESA"&&manualMessage.trim().length<10)}>{submitting?"Starting payment…":paymentMethod==="MPESA_EXPRESS"?"Pay frozen proposal":"Submit payment proof"}</button></form><aside><span className="prescription-summary-lock"><LockKeyhole/> Pharmacy locked</span><h2>{request.originalFilename}</h2>{proposalItems.map((item)=><article key={item.id}><div><strong>{item.productName}</strong><small>Qty {item.approvedQuantity} · KES {Number(item.unitPrice).toLocaleString()} each</small></div><span>KES {(Number(item.unitPrice)*Number(item.approvedQuantity)).toLocaleString()}</span></article>)}<div className="checkout-total"><span>Medicines<b>KES {subtotal.toLocaleString()}</b></span><span>Delivery<b>{fulfilment!=="DELIVERY"?"KES 0":quotingDelivery?"Calculating…":!pin?"Pin your location":deliveryBlocked?"Unavailable":deliveryFee===0?"FREE":`KES ${deliveryFee.toLocaleString()}`}</b></span>{fulfilment==="DELIVERY"&&deliveryQuote?.available?<span className="checkout-delivery-detail">{deliveryQuote.free?"Order qualifies for free delivery":`${deliveryQuote.distanceKm.toLocaleString()} km${deliveryQuote.bandLabel?` · ${deliveryQuote.bandLabel}`:""}${deliveryQuote.branchName?` from ${deliveryQuote.branchName}`:""}`}</span>:null}<span>Total<strong>KES {total.toLocaleString()}</strong></span></div><p className="prescription-normal-cart-reminder"><ShoppingBag/> Other products in your normal cart remain untouched.</p></aside></div></main>;
}
