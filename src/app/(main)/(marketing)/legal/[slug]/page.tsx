import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCmsPageBySlug } from "@/lib/cms";
import { BlockRenderer } from "@/components/marketing/block-renderer";

const LEGAL_SLUGS = new Set(["terms", "privacy", "cookies", "dpa"]);

export const revalidate = 3600;

export async function generateStaticParams() {
  return Array.from(LEGAL_SLUGS).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const titles: Record<string, string> = {
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    cookies: "Cookie Policy",
    dpa: "Data Processing Addendum",
  };
  return {
    title: `${titles[slug] ?? "Legal"} — Danets AI Automation`,
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!LEGAL_SLUGS.has(slug)) notFound();

  // Look up the CMS version first; fall back to a minimal stub so
  // legal pages are never missing entirely.
  const page = await getCmsPageBySlug(`legal/${slug}`);
  if (page) return <BlockRenderer blocks={page.blocks} />;

  const defaults: Record<string, { title: string; body: string }> = {
    terms: {
      title: "Terms of Service",
      body:
        "These Terms of Service govern your use of Danets AI Automation. By creating an account or using the service you agree to these terms. The service is provided by Danets TecPro Limited. We may update these terms from time to time; continued use after changes means you accept the updated terms.",
    },
    privacy: {
      title: "Privacy Policy",
      body:
        "We collect only the data we need to operate the service: your account information, the messages your AI agent exchanges with your visitors, and basic usage telemetry. We do not sell your data. You can export or delete your data at any time from the dashboard settings.",
    },
    cookies: {
      title: "Cookie Policy",
      body:
        "We use a small number of strictly necessary cookies to keep you signed in and to remember your theme preference. We do not use third-party tracking cookies on the marketing site.",
    },
    dpa: {
      title: "Data Processing Addendum",
      body:
        "Where Danets TecPro processes personal data on your behalf, the Data Processing Addendum forms part of these terms. Contact us for a signed copy.",
    },
  };

  const fallback = defaults[slug];
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">
          {fallback.title}
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          {fallback.body}
        </p>
        <p className="text-xs text-muted-foreground">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </div>
    </section>
  );
}