import type { CmsSiteSettings } from "@/lib/cms";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://danetstecpro.com";

/**
 * JSON-LD helpers. These emit <script type="application/ld+json"> blocks
 * with schema.org structured data so search engines can render rich
 * results (Organization card, sitelinks search box, FAQ rich results).
 *
 * Server-rendered so the structured data is in the initial HTML — Google
 * does NOT execute JS for schema discovery.
 */

export function OrganizationJsonLd({
  site,
}: {
  site: CmsSiteSettings | null;
}) {
  const brand = site?.brandName ?? "Danets AI Automation";
  const tagline = site?.tagline ?? "AI chat, leads & proposals for your business";
  const json = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand,
    url: SITE_URL,
    logo: site?.logoUrl ?? `${SITE_URL}/icon.png`,
    description: tagline,
    email: site?.supportEmail ?? undefined,
    sameAs: site?.socialLinks
      ? Object.values(site.socialLinks).filter(Boolean)
      : undefined,
    parentOrganization: {
      "@type": "Organization",
      name: "Danets TecPro Limited",
      url: SITE_URL,
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

export function WebSiteJsonLd({ site }: { site: CmsSiteSettings | null }) {
  const json = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site?.brandName ?? "Danets AI Automation",
    url: SITE_URL,
    description: site?.tagline ?? undefined,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/blog?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

export function FAQPageJsonLd({
  items,
}: {
  items: { q: string; a: string }[];
}) {
  const json = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: it.a,
      },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

export function BlogPostingJsonLd({
  post,
}: {
  post: {
    slug: string;
    title: string;
    excerpt: string | null;
    coverImage: string | null;
    publishedAt: string | null;
    author: { name: string } | null;
  };
}) {
  const json = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    url: `${SITE_URL}/blog/${post.slug}`,
    datePublished: post.publishedAt ?? undefined,
    author: post.author
      ? { "@type": "Person", name: post.author.name }
      : undefined,
    image: post.coverImage ?? undefined,
    description: post.excerpt ?? undefined,
    publisher: {
      "@type": "Organization",
      name: "Danets TecPro Limited",
      url: SITE_URL,
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

export function ProductJsonLd({
  plan,
}: {
  plan: {
    name: string;
    priceUsd: number;
    description: string;
  };
}) {
  const json = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `Danets ${plan.name}`,
    description: plan.description,
    brand: { "@type": "Brand", name: "Danets TecPro Limited" },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: plan.priceUsd,
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}