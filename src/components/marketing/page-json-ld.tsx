import type { CmsPageRecord } from "@/lib/cms";
import {
  BlogPostingJsonLd,
  FAQPageJsonLd,
  ProductJsonLd,
} from "@/components/marketing/json-ld";

/**
 * Server component that picks the right JSON-LD blocks to emit for a given
 * CMS page. The marketing layout already emits Organization + WebSite;
 * here we add page-specific schema (FAQPage, Product, BlogPosting).
 */
export function PageJsonLd({ page }: { page: CmsPageRecord }) {
  const faqItems: { q: string; a: string }[] = [];
  const products: { name: string; priceUsd: number; description: string }[] = [];

  for (const block of page.blocks) {
    if (block.blockKey === "faq") {
      const items = (block.props as { items?: { q: string; a: string }[] })
        .items;
      if (Array.isArray(items)) {
        for (const it of items) {
          if (it?.q && it?.a) faqItems.push({ q: it.q, a: it.a });
        }
      }
    } else if (block.blockKey === "pricing-table") {
      const plans =
        (block.props as { plans?: unknown }).plans ??
        (block.props as { items?: unknown }).items;
      if (Array.isArray(plans)) {
        for (const p of plans) {
          const plan = p as { name?: string; priceUsd?: number };
          if (plan.name && typeof plan.priceUsd === "number") {
            products.push({
              name: plan.name,
              priceUsd: plan.priceUsd,
              description: `Danets ${plan.name} plan`,
            });
          }
        }
      }
    } else if (block.blockKey === "blog-post") {
      // handled at the blog post page, not via block renderer
    }
  }

  return (
    <>
      {faqItems.length > 0 ? (
        <FAQPageJsonLd items={faqItems} />
      ) : null}
      {products.map((p) => (
        <ProductJsonLd key={p.name} plan={p} />
      ))}
    </>
  );
}

/**
 * For the dedicated /blog/[slug] route — emits BlogPosting structured data.
 */
export function PostJsonLd({
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
  return <BlogPostingJsonLd post={post} />;
}