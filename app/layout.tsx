import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Healthfield Pharmacy",
    template: "%s | Healthfield Pharmacy",
  },
  description:
    "Shop medicines, skincare, wellness and personal-care products from Healthfield Pharmacy.",
  keywords:["online pharmacy Kenya","medicines Kenya","skincare Kenya","vitamins and supplements","Healthfield Pharmacy"],
  openGraph:{type:"website",siteName:"Healthfield Pharmacy",title:"Healthfield Pharmacy",description:"Shop medicines, skincare, wellness and personal-care products online.",images:["/healthfield-hero-pharmacist.png"]},
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/healthfield-icon.png",
    apple: "/healthfield-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geist.variable}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"Pharmacy",name:"Healthfield Pharmacy",url:process.env.APP_URL??"https://healthfieldpharmacy.co.ke",logo:`${(process.env.APP_URL??"https://healthfieldpharmacy.co.ke").replace(/\/$/,"")}/healthfield-logo-clean.png`}).replace(/</g,"\\u003c")}}/>{children}</body>
    </html>
  );
}
