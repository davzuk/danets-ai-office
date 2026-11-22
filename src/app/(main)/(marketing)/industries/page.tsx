import type { Metadata } from "next";
import { getCmsPageBySlug } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";
import { MarketingFallback } from "@/components/marketing/marketing-fallback";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Industries — Danets AI Automation",
  description:
    "See how businesses across industries use Danets AI Automation to capture leads, automate chat, and close deals.",
};

export default async function IndustriesPage() {
  const page = await getCmsPageBySlug("industries");
  if (!page) return <MarketingFallback slug="industries" />;
  return <BlockRenderer blocks={page.blocks} />;
}
