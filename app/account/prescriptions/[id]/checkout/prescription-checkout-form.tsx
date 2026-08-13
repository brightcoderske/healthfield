"use client";

import { ArrowLeft, Check, CheckCircle2, Clipboard, CreditCard, LoaderCircle, LocateFixed, LockKeyhole, MapPin, ReceiptText, ShoppingBag, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CustomerPrescriptionData } from "../../types";

type PaymentMethod="MPESA_EXPRESS"|"MANUAL_MPESA";
type CheckoutResult={id:number;orderNumber:string;total:number;state:"WAITING"|"REVIEW"|"PAID"|"FAILED";message:string};

export function PrescriptionCheckoutForm({prescriptionId,data}:{prescriptionId:number;data:CustomerPrescriptionData}){
  const {request,items,order,customer,payment}=data;
  const [fulfilment,setFulfilment]=useState<"DELIVERY"|"PICKUP">("DELIVERY");
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod>(payment.onlineMpesaEnabled?"MPESA_EXPRESS":"MANUAL_MPESA");
  const [manualMessage,setManualMessage]=useState(""),[error,setError]=useState(""),[submitting,setSubmitting]=useState(false),[copied,setCopied]=useState(false),[locating,setLocating]=useState(false);
  const [coordinates,setCoordinates]=useState<{latitude:number;longitude:number}|null>(null),[result,setResult]=useState<CheckoutResult|null>(null);
  const checkoutToken=useRef(globalThis.crypto.randomUUID()),pollCount=useRef(0);
  const proposalItems=items.filter((item)=>item.availability!=="UNAVAILABLE"&&item.approvedQuantity&&item.unitPrice);
  const subtotal=Number(order!.subtotal),deliveryFee=fulfilment==="DELIVERY"?250:0,total=subtotal+deliveryFee;
  const noPayments=!payment.onlineMpesaEnabled&&!payment.onlineManualEnabled;

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
      else if(pollCount.current>=24)setResult((current)=>current?{...current,state:"FAILED",message:"We could not confirm the M-Pesa prompt. Return to the proposal to try again or choose manual M-Pesa."}:current);
    }
    void check();const timer=window.setInterval(()=>void check(),5000);return()=>{cancelled=true;window.clearInterval(timer)};
  },[result?.state]);

  function locate(){
    if(!navigator.geolocation){setError("Location services are not available on this device.");return}
    setLocating(true);setError("");navigator.geolocation.getCurrentPosition(({coords})=>{setCoordinates({latitude:coords.latitude,longitude:coords.longitude});setLocating(false)},()=>{setError("Allow location access, then try again.");setLocating(false)},{enableHighAccuracy:true,timeout:12000});
  }
  async function copyTill(){
    if(!payment.tillNumber)return;
    try{await navigator.clipboard.writeText(payment.tillNumber);setCopied(true);window.setTimeout(()=>setCopied(false),2000)}catch{setError(`Copy the till number manually: ${payment.tillNumber}`)}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(submitting||result)return;
    const form=new FormData(event.currentTarget),value=(name:string)=>String(form.get(name)||"").trim();
    setSubmitting(true);setError("");
    try{
      const response=await fetch(`/api/prescriptions/${prescriptionId}/checkout`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutToken:checkoutToken.current,fulfilmentMethod:fulfilment,paymentMethod,phone:value("phone"),billingPhone:paymentMethod==="MPESA_EXPRESS"?value("billingPhone"):undefined,manualPaymentMessage:paymentMethod==="MANUAL_MPESA"?manualMessage.trim():undefined,deliveryAddress:fulfilment==="DELIVERY"?value("deliveryAddress"):undefined,deliveryArea:fulfilment==="DELIVERY"?value("deliveryArea"):undefined,deliveryLatitude:coordinates?.latitude,deliveryLongitude:coordinates?.longitude})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){setError(payload.error||"Unable to start prescription checkout.");return}
      const state=payload.paymentStatus==="PAID"?"PAID":paymentMethod==="MANUAL_MPESA"?"REVIEW":payload.paymentStatus==="FAILED"?"FAILED":"WAITING";
      setResult({id:payload.id,orderNumber:payload.orderNumber,total:Number(payload.total),state,message:payload.paymentMessage||"Payment request started."});
    }catch{setError("Unable to reach checkout. Please try again.")}finally{setSubmitting(false)}
  }

  const tillPanel=payment.onlineManualEnabled?<div className="manual-payment-panel"><div><span>Pay to M-Pesa Till</span><strong>{payment.tillNumber}</strong><small>{payment.accountName||"Healthfield Pharmacy"}</small></div><button type="button" onClick={copyTill}>{copied?<Check/>:<Clipboard/>}{copied?"Copied":"Copy till"}</button><p>Exact amount: <strong>KES {total.toLocaleString()}</strong></p><label>Paste the complete M-Pesa confirmation message<textarea value={manualMessage} onChange={(event)=>setManualMessage(event.target.value)} rows={4} placeholder="Paste the message showing the transaction code, amount and till payment" required/></label></div>:null;

  if(result)return <main className={`checkout-success payment-result payment-${result.state.toLowerCase()} prescription-payment-result`}>{result.state==="WAITING"?<LoaderCircle className="spin"/>:result.state==="FAILED"?<ReceiptText/>:<CheckCircle2/>}<span>{result.orderNumber}</span><h1>{result.state==="PAID"?"Payment confirmed":result.state==="REVIEW"?"Payment proof received":result.state==="WAITING"?"Approve payment on your phone":"Payment not completed"}</h1><p>{result.message}</p><strong>KES {result.total.toLocaleString()}</strong><small>Your ordinary shopping cart was not changed.</small><div><Link href={`/account/prescriptions/${prescriptionId}`}>Back to prescription</Link><Link href="/#products"><ShoppingBag/> Continue shopping</Link></div></main>;

  return <main className="checkout-page prescription-checkout-page"><header><Link href={`/account/prescriptions/${prescriptionId}`}><ArrowLeft/> Proposal</Link><strong><LockKeyhole/> Secure prescription checkout</strong><Link href="/#products">Keep shopping</Link></header><div className="checkout-layout"><form onSubmit={submit}><span className="auth-kicker">Frozen pharmacy proposal</span><h1>Delivery and payment</h1><p className="prescription-checkout-note">The pharmacist-selected products below are locked. This checkout is separate from your normal cart.</p><div className="checkout-methods"><button type="button" className={fulfilment==="DELIVERY"?"active":""} onClick={()=>setFulfilment("DELIVERY")}><MapPin/> Home delivery</button><button type="button" className={fulfilment==="PICKUP"?"active":""} onClick={()=>setFulfilment("PICKUP")}><ShoppingBag/> Pharmacy pickup</button></div><div className="checkout-fields"><label>Customer<input value={`${customer.firstName} ${customer.lastName}`} disabled/></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" defaultValue={customer.phone||""} required/></label>{fulfilment==="DELIVERY"?<><label>Town or area<input name="deliveryArea" required/></label><label className="full">Delivery address<textarea name="deliveryAddress" rows={3} required/></label><div className="checkout-location full"><button type="button" onClick={locate} disabled={locating}><LocateFixed/>{locating?"Getting location…":coordinates?"Location captured":"Use my current location"}</button></div></>:null}</div><h2>Payment method</h2><div className="payment-options">{payment.onlineMpesaEnabled?<label className={`payment-choice ${paymentMethod==="MPESA_EXPRESS"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MPESA_EXPRESS" checked={paymentMethod==="MPESA_EXPRESS"} onChange={()=>setPaymentMethod("MPESA_EXPRESS")}/><Smartphone/><span><strong>M-Pesa Express</strong><small>Receive a secure prompt on your phone</small></span></label>:null}{payment.onlineManualEnabled?<label className={`payment-choice ${paymentMethod==="MANUAL_MPESA"?"active":""}`}><input type="radio" name="prescriptionPayment" value="MANUAL_MPESA" checked={paymentMethod==="MANUAL_MPESA"} onChange={()=>setPaymentMethod("MANUAL_MPESA")}/><CreditCard/><span><strong>Manual M-Pesa</strong><small>Pay to the till and submit the confirmation</small></span></label>:null}</div>{paymentMethod==="MPESA_EXPRESS"&&payment.onlineMpesaEnabled?<label className="billing-phone">Phone to receive the prompt<input name="billingPhone" type="tel" defaultValue={customer.phone||""} required/></label>:null}{paymentMethod==="MANUAL_MPESA"?tillPanel:null}{noPayments?<div className="auth-error" role="alert">Online payment is temporarily unavailable. Your proposal remains saved.</div>:null}{error?<div className="auth-error" role="alert">{error}</div>:null}<button className="place-order" disabled={submitting||noPayments||(paymentMethod==="MANUAL_MPESA"&&manualMessage.trim().length<10)}>{submitting?"Starting payment…":paymentMethod==="MPESA_EXPRESS"?"Pay frozen proposal":"Submit payment proof"}</button></form><aside><span className="prescription-summary-lock"><LockKeyhole/> Pharmacy locked</span><h2>{request.originalFilename}</h2>{proposalItems.map((item)=><article key={item.id}><div><strong>{item.productName}</strong><small>Qty {item.approvedQuantity} · KES {Number(item.unitPrice).toLocaleString()} each</small></div><span>KES {(Number(item.unitPrice)*Number(item.approvedQuantity)).toLocaleString()}</span></article>)}<div className="checkout-total"><span>Medicines<b>KES {subtotal.toLocaleString()}</b></span><span>Delivery<b>KES {deliveryFee.toLocaleString()}</b></span><span>Total<strong>KES {total.toLocaleString()}</strong></span></div><p className="prescription-normal-cart-reminder"><ShoppingBag/> Other products in your normal cart remain untouched.</p></aside></div></main>;
}
