import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./payment-settings.css";
import "./enhancements.css";
import "./latest-fixes.css";
import "./licence-admin.css";
import "./product-actions-compact.css";
import "./product-card-layout-fix.css";
import "./blog-admin-polish.css";
import "./call-menu.css";
import "./condition-matrix.css";
import "./footer-licence.css";
import "./two-factor.css";
import "./homepage-fixes.css";
import "./product-page-polish.css";
import "./registration-notice.css";
import "./responsive-ui.css";
import "./product-grid.css";
import "./offers-ui.css";
import "./catalogue-breaks.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Healthfield Pharmacy",
    template: "%s | Healthfield Pharmacy",
  },
  description:"Healthfield Pharmacy serves Juja, Nairobi, Kahawa West and Thika Road with genuine medicines, pharmacist support, prescription fulfilment and wellness products.",
  keywords:["pharmacy in Juja","pharmacy in Nairobi CBD","pharmacy in Nairobi","pharmacy in Thika","pharmacy in Kahawa West","pharmacy on Thika Road","pharmacy near me","chemist around me","pharmacist near me","online pharmacy Kenya","medicine delivery Kenya"],
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
      <body className={geist.variable}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"Pharmacy",name:"Healthfield Pharmacy",url:process.env.APP_URL??"https://healthfieldpharmacy.co.ke",logo:`${(process.env.APP_URL??"https://healthfieldpharmacy.co.ke").replace(/\/$/,"")}/healthfield-logo-clean.png`,areaServed:["Juja","Nairobi","Kahawa West","Thika Road"],medicalSpecialty:"Pharmacy"}).replace(/</g,"\\u003c")}}/>{children}</body>
    </html>
  );
}
