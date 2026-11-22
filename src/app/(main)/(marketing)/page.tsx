import type { Metadata } from "next";
import { getCmsPageBySlug, getCmsSite } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";
import { MarketingFallback } from "@/components/marketing/marketing-fallback";

const HOME_SLUG = "home";

// Always revalidate after CMS edits; cache key includes the slug.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [page, site] = await Promise.all([
    getCmsPageBySlug(HOME_SLUG),
    getCmsSite(),
  ]);
  const title =
    (page?.seo as { title?: string } | null)?.title ||
    page?.title ||
    site?.seoDefaults?.title ||
    "Danets AI Automation — AI chat, leads & proposals for your business";
  const description =
    page?.description ||
    site?.seoDefaults?.description ||
    "Deploy an AI chatbot on your website, capture leads 24/7, generate quotes and automate customer support. Secure multi-tenant platform by Danets TecPro Limited.";
  const ogImage = page?.ogImage || site?.seoDefaults?.ogImage;
  const baseUrl = site?.domain ? `https://${site.domain}` : undefined;
  return {
    title,
    description,
    openGraph: ogImage
      ? { title, description, images: [{ url: ogImage }] }
      : { title, description },
    alternates: baseUrl ? { canonical: baseUrl } : undefined,
  };
}

export default async function MarketingHome() {
  const page = await getCmsPageBySlug(HOME_SLUG);
  // Render a fallback hero + CTA if the CMS row is missing rather than 404.
  // A freshly-seeded DB or a misconfigured admin must not turn every visitor
  // into a 404. The fallback matches the home eyebrow/title so search engines
  // get a consistent snippet.
  if (!page) {
    return <MarketingFallback slug={HOME_SLUG} />;
  }
  return <BlockRenderer blocks={page.blocks} />;
}
