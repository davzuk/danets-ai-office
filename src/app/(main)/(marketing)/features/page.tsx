import type { Metadata } from "next";
import { getCmsPageBySlug } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";
import { MarketingFallback } from "@/components/marketing/marketing-fallback";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Features — Danets AI Automation",
  description:
    "AI chat, lead capture, quote generation, WhatsApp automation, integrations, and more — all in one secure dashboard.",
};

export default async function FeaturesPage() {
  const page = await getCmsPageBySlug("features");
  if (!page) return <MarketingFallback slug="features" />;
  return <BlockRenderer blocks={page.blocks} />;
}
