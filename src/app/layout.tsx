import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/pwa/register-sw";
import { CsrfProvider } from "@/components/csrf-provider";
import { QueryProvider } from "@/components/query-provider";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
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
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Danets AI" },
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

export const viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <CsrfProvider>{children}</CsrfProvider>
          </QueryProvider>
          <Toaster />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
