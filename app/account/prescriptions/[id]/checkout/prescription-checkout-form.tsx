"use client";

import { ArrowLeft, Check, CheckCircle2, Clipboard, CreditCard, LoaderCircle, LockKeyhole, MapPin, ReceiptText, ShoppingBag, Smartphone } from "lucide-react";
import { vatOnNet } from "@/lib/vat";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { paymentPollDelay } from "@/lib/payment-poll";
import { createCheckoutToken } from "@/lib/checkout-token";
import { MapPicker, type PinnedLocation } from "../../../../map-picker";
import { useDeliveryQuote } from "../../../../use-delivery-quote";
import type { CustomerPrescriptionData } from "../../types";

type PaymentMethod="MPESA_EXPRESS"|"MANUAL_MPESA";
/** The customer's own cart, as the page read it, to be paid for together with the prescription. */
export type CartExtras={products:Array<{id:number;name:string;price:number;quantity:number}>;offers:Array<{id:number;title:string;total:number;items:Array<{productId:number;quantity:number}>}>;heldBack:string[]};
type CheckoutResult={id:number;orderNumber:string;total:number;state:"WAITING"|"REVIEW"|"PAID"|"FAILED";message:string};

export function PrescriptionCheckoutForm({prescriptionId,data,extras}:{prescriptionId:number;data:CustomerPrescriptionData;extras:CartExtras}){
  const {request,items,order,customer,payment}=data;
  const [fulfilment,setFulfilment]=useState<"DELIVERY"|"PICKUP">("DELIVERY");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod>(payment.onlineMpesaEnabled?"MPESA_EXPRESS":"MANUAL_MPESA");
  const [manualMessage,setManualMessage]=useState(""),[error,setError]=useState(""),[submitting,setSubmitting]=useState(false),[copied,setCopied]=useState(false);
  // The prompt goes to the number typed above unless the patient says otherwise.
  const [phone,setPhone]=useState(customer.phone||""),[billingPhone,setBillingPhone]=useState(customer.phone||""),[billingPhoneTouched,setBillingPhoneTouched]=useState(false);
  const [pin,setPin]=useState<PinnedLocation|null>(null),[address,setAddress]=useState(""),[addressTouched,setAddressTouched]=useState(false),[result,setResult]=useState<CheckoutResult|null>(null);
  const checkoutToken=useRef(createCheckoutToken()),pollCount=useRef(0);
  // What the pharmacist's order actually holds: the lines chosen for today, at the quantity chosen.
  const proposalItems=items.filter((item)=>item.availability!=="UNAVAILABLE"&&item.approvedQuantity&&item.unitPrice&&!item.deferred).map((item)=>({...item,quantity:Number(item.selectedQuantity??item.approvedQuantity)}));
  const proposalSubtotal=Number(order!.subtotal);
  const extrasSubtotal=extras.products.reduce((sum,product)=>sum+product.price*product.quantity,0)+extras.offers.reduce((sum,offer)=>sum+offer.total,0);
  const subtotal=proposalSubtotal+extrasSubtotal;
  // The prices are the pharmacist's and the shop's; only the delivery leg is quoted here.
  const quotedLines=[...proposalItems.flatMap((item)=>item.productId?[{productId:item.productId,quantity:item.quantity}]:[]),...extras.products.map((product)=>({productId:product.id,quantity:product.quantity})),...extras.offers.flatMap((offer)=>offer.items)];
  const {quote:deliveryQuote,loading:quotingDelivery}=useDeliveryQuote({active:fulfilment==="DELIVERY",pin,subtotal,items:quotedLines});
  const vatRate=data.vat?.enabled?data.vat.rate:0;
  const vat=vatRate?vatOnNet(subtotal,vatRate)??0:0;
  const deliveryBlocked=fulfilment==="DELIVERY"&&Boolean(deliveryQuote&&!deliveryQuote.available);
  const deliveryFee=fulfilment==="DELIVERY"&&deliveryQuote?.available?deliveryQuote.fee:0;
  const total=Math.round((subtotal+vat+deliveryFee)*100)/100;
  const noPayments=!payment.onlineMpesaEnabled&&!payment.onlineManualEnabled;
  // Seeded alongside the pin rather than in an effect, and never over anything typed.
  function pinLocation(location:PinnedLocation|null){setPin(location);if(location?.address&&!addressTouched)setAddress(location.address)}

  // The cart's items were part of this payment, so once it has gone through they are no
  // longer in the cart. Held back until then: a payment that fails must not lose them.
  const clearedCart=useRef(false);
  useEffect(()=>{
    if(clearedCart.current||(extras.products.length+extras.offers.length)===0)return;
    if(result?.state==="PAID"||result?.state==="REVIEW"){clearedCart.current=true;void fetch("/api/cart",{method:"DELETE"}).catch(()=>undefined)}
  },[result?.state,extras.products.length,extras.offers.length]);

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
      const response=await fetch(`/api/prescriptions/${prescriptionId}/checkout`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutToken:checkoutToken.current,fulfilmentMethod:fulfilment,paymentMethod,phone:value("phone"),billingPhone:paymentMethod==="MPESA_EXPRESS"?value("billingPhone"):undefined,manualPaymentMessage:paymentMethod==="MANUAL_MPESA"?manualMessage.trim():undefined,deliveryAddress:fulfilment==="DELIVERY"?value("deliveryAddress"):undefined,deliveryArea:fulfilment==="DELIVERY"?value("deliveryArea"):undefined,deliveryLatitude:pin?.latitude,deliveryLongitude:pin?.longitude,items:extras.products.map((product)=>({productId:product.id,quantity:product.quantity})),offerItems:extras.offers.map((offer)=>({offerId:offer.id}))})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){setError(payload.error||"Unable to start prescription checkout.");return}
      const state=payload.paymentStatus==="PAID"?"PAID":paymentMethod==="MANUAL_MPESA"?"REVIEW":payload.paymentStatus==="FAILED"?"FAILED":"WAITING";
      setResult({id:payload.id,orderNumber:payload.orderNumber,total:Number(payload.total),state,message:payload.paymentMessage||"Payment request started."});
    }catch{setError("Unable to reach checkout. Please try again.")}finally{setSubmitting(false)}
  }

  const tillPanel=payment.onlineManualEnabled?<div className="manual-payment-panel"><div><span>Pay to M-Pesa Till</span><strong>{payment.tillNumber}</strong><small>{payment.accountName||"Healthfield Pharmacy"}</small></div><button type="button" onClick={copyTill}>{copied?<Check/>:<Clipboard/>}{copied?"Copied":"Copy till"}</button><p>Exact amount: <strong>KES {total.toLocaleString()}</strong></p><p className="manual-payment-hint">Pay that exact amount to the till, then paste the confirmation message Safaricom sends you. The code inside it is what links your payment to this prescription.</p><label>Paste the complete M-Pesa confirmation message<textarea value={manualMessage} onChange={(event)=>setManualMessage(event.target.value)} rows={4} placeholder="Paste the message showing the transaction code, amount and till payment" required/></label></div>:null;

  if(result)return <main className={`checkout-success payment-result payment-${result.state.toLowerCase()} prescription-payment-result`}>{result.state==="WAITING"?<LoaderCircle className="spin"/>:result.state==="FAILED"?<ReceiptText/>:<CheckCircle2/>}<span>{result.orderNumber}</span><h1>{result.state==="PAID"?"Payment confirmed":result.state==="REVIEW"?"Payment proof received":result.state==="WAITING"?"Approve payment on your phone":"Payment not completed"}</h1><p>{result.message}</p><strong>KES {result.total.toLocaleString()}</strong>{(extras.products.length+extras.offers.length)>0?<small>The items from your cart were included in this payment.</small>:null}<div><Link href={`/account/prescriptions/${prescriptionId}`}>Back to prescription</Link><Link href="/#products"><ShoppingBag/> Continue shopping</Link></div></main>;

  return <main className="checkout-page prescription-checkout-page"><header><Link href={`/account/prescriptions/${prescriptionId}`}><ArrowLeft/> Proposal</Link><strong><LockKeyhole/> Secure prescription checkout</strong><Link href="/#products">Keep shopping</Link></header><div className="checkout-layout"><form onSubmit={submit}><span className="auth-kicker">Your prescription{extrasSubtotal>0?" and your cart":""}</span><h1>Delivery and payment</h1><div className="prescription-checkout-explain"><strong>What you are paying for</strong><ul><li><b>Prescription medicines</b> are set by your pharmacist. Full-course medicines are locked at the prescribed amount; to buy less of an adjustable one, or leave something for later, <Link href={`/account/prescriptions/${prescriptionId}`}>change it on your prescription</Link> before paying.</li>{extras.products.length+extras.offers.length>0?<li><b>Your own items</b> from the cart are added to this same payment, so you pay once and get one delivery. Change them in <Link href="/cart">your cart</Link>; the prescription is not affected.</li>:<li>Want anything else with your medicines? Add it to your <Link href="/cart">cart</Link> first and it will be paid for together, in one payment.</li>}</ul></div>{extras.heldBack.length?<div className="auth-error" role="alert">{extras.heldBack.join(", ")} {extras.heldBack.length===1?"needs":"need"} a prescription, so {extras.heldBack.length===1?"it is":"they are"} not included here. Send {extras.heldBack.length===1?"it":"them"} to the pharmacist and it will be priced for you.</div>:null}<div className="checkout-methods"><button type="button" className={fulfilment==="DELIVERY"?"active":""} onClick={()=>setFulfilment("DELIVERY")}><MapPin/> Home delivery</button><button type="button" className={fulfilment==="PICKUP"?"active":""} onClick={()=>setFulfilment("PICKUP")}><ShoppingBag/> Pharmacy pickup</button></div><div className="checkout-fields"><label>Customer<input value={`${customer.firstName} ${customer.lastName}`} disabled/></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" value={phone} onChange={event=>{setPhone(event.target.value);if(!billingPhoneTouched)setBillingPhone(event.target.value)}} required/></label>{fulfilment==="DELIVERY"?<><label>Town or area<input name="deliveryArea" required/></label><div className="checkout-location full"><span className="checkout-location-title"><MapPin/> Pin your delivery location</span><p className="checkout-location-note">The delivery fee is worked out from how far this pin is from the branch dispensing your prescription.</p><MapPicker value={pin} onChange={pinLocation}/><label className="full">Delivery address<textarea name="deliveryAddress" rows={3} required value={address} onChange={event=>{setAddressTouched(true);setAddress(event.target.value)}} placeholder="House or building name, floor, anything that helps the rider find you"/></label>{deliveryQuote&&!deliveryQuote.available?<div className="auth-error" role="alert">{deliveryQuote.message} Choose pharmacy pickup, or pin a location inside the delivery area.</div>:null}{deliveryQuote?.available&&deliveryQuote.courier?<p className="checkout-location-courier">Delivered by {deliveryQuote.courier} on Healthfield&rsquo;s behalf.</p>:null}</div></>:null}</div><h2>Payment method</h2><div className="payment-options">{payment.onlineMpesaEnabled?<label className={`payment-choice ${paymentMethod==="MPESA_EXPRESS"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MPESA_EXPRESS" checked={paymentMethod==="MPESA_EXPRESS"} onChange={()=>setPaymentMethod("MPESA_EXPRESS")}/><Smartphone/><span><strong>M-Pesa Express</strong><small>Receive a secure prompt on your phone</small></span></label>:null}{payment.onlineManualEnabled?<label className={`payment-choice ${paymentMethod==="MANUAL_MPESA"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MANUAL_MPESA" checked={paymentMethod==="MANUAL_MPESA"} onChange={()=>setPaymentMethod("MANUAL_MPESA")}/><CreditCard/><span><strong>Manual M-Pesa</strong><small>Pay to the till and submit the confirmation</small></span></label>:null}</div>{paymentMethod==="MPESA_EXPRESS"&&payment.onlineMpesaEnabled?<label className="billing-phone">Phone to receive the prompt<input name="billingPhone" type="tel" value={billingPhone} onChange={event=>{setBillingPhoneTouched(true);setBillingPhone(event.target.value)}} required/><small>Taken from the number above. Change it to pay from another phone.</small></label>:null}{paymentMethod==="MANUAL_MPESA"?tillPanel:null}{noPayments?<div className="auth-error" role="alert">Online payment is temporarily unavailable. Your proposal remains saved.</div>:null}{error?<div className="auth-error" role="alert">{error}</div>:null}<button className="place-order" disabled={submitting||noPayments||(paymentMethod==="MANUAL_MPESA"&&manualMessage.trim().length<10)}>{submitting?"Starting payment…":paymentMethod==="MPESA_EXPRESS"?`Pay KES ${total.toLocaleString()}`:"Submit payment proof"}</button></form><aside><span className="prescription-summary-lock"><LockKeyhole/> From your pharmacist</span><h2>{request.originalFilename}</h2>{proposalItems.map((item)=><article key={item.id}><div><strong>{item.productName}</strong><small>Qty {item.quantity} · KES {Number(item.unitPrice).toLocaleString()} each · {item.dispenseRule==="COURSE_BOUND"?"locked, full course":"adjustable on your prescription"}</small></div><span>KES {(Number(item.unitPrice)*item.quantity).toLocaleString()}</span></article>)}{extrasSubtotal>0?<><span className="prescription-summary-lock"><ShoppingBag/> Added from your cart</span>{extras.products.map((product)=><article key={`p${product.id}`}><div><strong>{product.name}</strong><small>Qty {product.quantity} · KES {product.price.toLocaleString()} each</small></div><span>KES {(product.price*product.quantity).toLocaleString()}</span></article>)}{extras.offers.map((offer)=><article key={`o${offer.id}`}><div><strong>{offer.title}</strong><small>Bundle</small></div><span>KES {offer.total.toLocaleString()}</span></article>)}</>:null}<div className="checkout-total"><span>Medicines<b>KES {subtotal.toLocaleString()}</b></span>{vat>0?<span>VAT ({vatRate}%)<b>KES {vat.toLocaleString()}</b></span>:null}<span>Delivery<b>{fulfilment!=="DELIVERY"?"KES 0":quotingDelivery?"Calculating…":!pin?"Pin your location":deliveryBlocked?"Unavailable":deliveryFee===0?"FREE":`KES ${deliveryFee.toLocaleString()}`}</b></span>{fulfilment==="DELIVERY"&&deliveryQuote?.available?<span className="checkout-delivery-detail">{deliveryQuote.free?"Order qualifies for free delivery":`${deliveryQuote.distanceKm.toLocaleString()} km${deliveryQuote.bandLabel?` · ${deliveryQuote.bandLabel}`:""}${deliveryQuote.branchName?` from ${deliveryQuote.branchName}`:""}`}</span>:null}<span>Total<strong>KES {total.toLocaleString()}</strong></span></div><p className="prescription-normal-cart-reminder"><ShoppingBag/> {extrasSubtotal>0?"One payment covers both the prescription and your cart.":"Anything you add to your cart before paying is included in this payment."}</p></aside></div></main>;
}
