import type { Metadata } from "next";
import { getCmsPageBySlug } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";
import { MarketingFallback } from "@/components/marketing/marketing-fallback";
import { PageJsonLd } from "@/components/marketing/page-json-ld";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Pricing — Danets AI Automation",
  description:
    "Simple, transparent pricing for the Danets AI Automation platform. Start free, upgrade as you grow.",
};

export default async function PricingPage() {
  const page = await getCmsPageBySlug("pricing");
  if (!page) return <MarketingFallback slug="pricing" />;
  return (
    <>
      <PageJsonLd page={page} />
      <BlockRenderer blocks={page.blocks} />
    </>
  );
}
