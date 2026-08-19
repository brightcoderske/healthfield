import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./payment-settings.css";
import "./enhancements.css";
import "./latest-fixes.css";
import "./licence-admin.css";
import "./product-actions-compact.css";
import "./product-card-layout-fix.css";
import "./blog-admin-polish.css";
import "./promotional-banners-admin.css";
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
import "./blog-index.css";
import "./thermal-receipt.css";
import "./consultations-ui.css";
import "./delivery-ui.css";
import "./prescription-hero.css";
import "./editor-modal-mobile.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

/**
 * `resizes-content` makes Android Chrome shrink the layout viewport when the keyboard
 * opens, instead of sliding it out of sight. Sticky footers inside the admin editors
 * then stay where they are put, which is half of keeping Save reachable while typing.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Healthfield Pharmacy Website | Pharmacy in Kenya",
    template: "%s | Healthfield Pharmacy",
  },
  description:"Shop genuine medicines and wellness products on the Healthfield Pharmacy website, with pharmacist support in Juja, Nairobi and across Kenya.",
  keywords:["Healthfield Pharmacy website","pharmacy in Kenya","pharmacy in Juja","pharmacy in Nairobi CBD","pharmacy in Nairobi","best pharmacy in Kenya","where can I get a pharmacist in Kenya","where can I get a pharmacist in Nairobi","pharmacy in Thika","pharmacy in Kahawa West","pharmacy on Thika Road","pharmacy near me","chemist around me","pharmacist near me","online pharmacy Kenya","medicine delivery Kenya"],
  openGraph:{type:"website",siteName:"Healthfield Pharmacy",title:"Healthfield Pharmacy Website | Pharmacy in Kenya",description:"Shop genuine medicines and wellness products with pharmacist support in Juja, Nairobi and across Kenya.",images:["/healthfield-hero-pharmacist.png"]},
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
    <html lang="en" data-scroll-behavior="smooth">
      <body className={geist.variable}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"Pharmacy",name:"Healthfield Pharmacy",url:process.env.APP_URL??"https://healthfieldpharmacy.co.ke",logo:`${(process.env.APP_URL??"https://healthfieldpharmacy.co.ke").replace(/\/$/,"")}/healthfield-logo-clean.png`,areaServed:["Juja","Nairobi","Kahawa West","Thika Road"],medicalSpecialty:"Pharmacy"}).replace(/</g,"\\u003c")}}/>{children}</body>
    </html>
  );
}
