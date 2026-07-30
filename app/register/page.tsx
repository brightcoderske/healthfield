"use client";
import Image from "next/image";
import { FormEvent, useState } from "react";
export default function RegisterPage() {
  const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const response=await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(form))});const data=await response.json();if(!response.ok)return setError(data.error);window.location.assign(data.redirectTo);}
  return <main className="register-page"><form onSubmit={submit}><a href="/"><Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={240} height={85}/></a><span className="auth-kicker">Customer account</span><h1>Create your account</h1><p>Track orders, save addresses and manage prescriptions.</p><div><label>First name<input name="firstName" required/></label><label>Last name<input name="lastName" required/></label><label>Email<input name="email" type="email" required/></label><label>Phone<input name="phone" required/></label><label className="full">Password<input name="password" type="password" minLength={8} required/><small>At least 8 characters with uppercase, lowercase and a number.</small></label></div>{error&&<div className="auth-error">{error}</div>}<button>Create account</button><a href="/login">Already registered? Log in</a></form></main>;
}
