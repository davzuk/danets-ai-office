import type { Metadata } from "next";
import { getCmsPageBySlug } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";
import { MarketingFallback } from "@/components/marketing/marketing-fallback";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "About — Danets AI Automation",
  description:
    "Danets TecPro Limited builds AI automation tools for businesses that want to move faster.",
};

export default async function AboutPage() {
  const page = await getCmsPageBySlug("about");
  if (!page) return <MarketingFallback slug="about" />;
  return <BlockRenderer blocks={page.blocks} />;
}
