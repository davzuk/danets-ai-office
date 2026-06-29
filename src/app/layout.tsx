import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Danets AI Automation — Danets TecPro Limited",
  description:
    "Automate website chat, customer support, lead capture, quotation generation and business workflows with AI. Secure multi-tenant platform by Danets TecPro Limited.",
  keywords: [
    "Danets",
    "AI automation",
    "chatbot",
    "lead capture",
    "quote generator",
    "customer support",
    "SaaS",
  ],
  authors: [{ name: "Danets TecPro Limited" }],
  openGraph: {
    title: "Danets AI Automation",
    description:
      "AI-powered website chat, lead capture and proposal generation for businesses.",
    siteName: "Danets AI Automation",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Danets AI Automation",
    description:
      "AI-powered website chat, lead capture and proposal generation for businesses.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
