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
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
