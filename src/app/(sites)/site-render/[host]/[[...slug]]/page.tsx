import type { Metadata } from "next";
import { after } from "next/server";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { SiteBlocks, SiteFrame } from "@/components/sites/site-blocks";
import { appOrigin, getPublishedPage, getRenderSite, getSiteNav, pageUrl, recordPageView, type RenderSite } from "@/lib/sites/server";

// A tenant website page. Reached only through the middleware's rewrite of
// <subdomain>.SITES_DOMAIN/<slug> or a custom domain; the app host 404s
// /site-render/*. A site with a verified custom domain serves its pages
// there, and its subdomain redirects.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ host: string; slug?: string[] }> };

async function load(params: Props["params"]) {
  const { host, slug } = await params;
  const site = await getRenderSite(host);
  if (!site) return null;
  const path = (slug ?? []).map((s) => decodeURIComponent(s)).join("/");
  const page = await getPublishedPage(site.id, path);
  return page ? { site, page } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found) return { title: "Page not found", robots: { index: false } };
  const { site, page } = found;
  const base = page.seo.title || page.title;
  const suffix = site.seoDefaults?.titleSuffix ?? site.name;
  const title = page.slug === "" && !page.seo.title ? site.name : suffix && !base.includes(suffix) ? `${base} | ${suffix}` : base;
  const description = page.seo.description || site.seoDefaults?.description || undefined;
  const image = page.seo.ogImageUrl || site.seoDefaults?.ogImageUrl || undefined;
  const url = pageUrl(site.origin, page.slug);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: page.seo.noindex ? { index: false, follow: false } : undefined,
    openGraph: { title, description, url, siteName: site.name, type: "website", images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
  };
}

/** LocalBusiness structured data from the business profile. */
function jsonLd(site: RenderSite) {
  const data: Record<string, unknown> = { "@context": "https://schema.org", "@type": "LocalBusiness", name: site.name, url: `${site.origin}/` };
  if (site.business.phone) data.telephone = site.business.phone;
  if (site.business.email) data.email = site.business.email;
  if (site.theme?.logoUrl) data.logo = site.theme.logoUrl;
  if (site.seoDefaults?.description) data.description = site.seoDefaults.description;
  // "<" escaped so the JSON can't close the script element.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function SitePage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { site, page } = found;
  if (site.customOrigin && site.servedOn === "subdomain") permanentRedirect(pageUrl(site.customOrigin, page.slug));
  const nav = await getSiteNav(site.id);
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;

  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip");
  const ua = h.get("user-agent");
  after(() => recordPageView(page.id, ip, ua));

  return (
    <>
      <SiteFrame name={site.name} theme={site.theme} nav={nav}>
        <SiteBlocks blocks={page.blocks} ctx={{ publicKey: site.publicKey, appOrigin: appOrigin() }} />
      </SiteFrame>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(site) }} />
      {site.widgetEnabled && <script src={`${appOrigin()}/widget.js?pk=${encodeURIComponent(site.publicKey)}`} nonce={nonce} async />}
    </>
  );
}
