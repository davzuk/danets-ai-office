import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getCmsPageBySlug,
  getCmsSite,
  listCmsPageSlugs,
} from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";

export const revalidate = 60;

// Reserved slugs that have their own dedicated route tree. Listing them
// here keeps the dynamic CMS route from accidentally shadowing them.
const RESERVED = new Set([
  "login",
  "signup",
  "app",
  "platform",
  "widget-demo",
  "blog",
  "changelog",
  "docs",
  "contact",
  "industries",
  "features",
  "pricing",
  "about",
  "legal",
  "admin",
]);

export async function generateStaticParams() {
  const slugs = await listCmsPageSlugs();
  return slugs
    .filter((s) => !RESERVED.has(s))
    .map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [page, site] = await Promise.all([
    getCmsPageBySlug(slug),
    getCmsSite(),
  ]);
  if (!page) {
    return {
      title: "Page not found",
    };
  }
  const seo = page.seo as
    | { title?: string; description?: string; canonical?: string; noindex?: boolean }
    | null;
  const title = seo?.title || page.title;
  const description = seo?.description || page.description || undefined;
  return {
    title,
    description,
    robots: seo?.noindex ? { index: false } : undefined,
    alternates: seo?.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: page.ogImage
      ? { title, description, images: [{ url: page.ogImage }] }
      : { title, description },
  };
}

export default async function MarketingCmsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (RESERVED.has(slug)) notFound();
  const page = await getCmsPageBySlug(slug);
  if (!page) notFound();
  return <BlockRenderer blocks={page.blocks} />;
}
