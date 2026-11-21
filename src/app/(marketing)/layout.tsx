import { headers } from "next/headers";
import { MarketingShell } from "@/components/marketing/shell";
import { getCmsSite } from "@/lib/cms";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/marketing/json-ld";

export const revalidate = 60; // ISR

/**
 * Marketing layout. Reads the current path so the top nav can highlight
 * the active section. All marketing pages inherit this shell.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The active path is read from the middleware-injected
  // `x-danets-pathname` header (set in src/middleware.ts).
  const hdrs = await headers();
  const pathname = hdrs.get("x-danets-pathname") ?? undefined;

  // Touch the site settings so they get cached for the page trees below.
  const site = await getCmsSite();

  return (
    <MarketingShell pathname={pathname ?? undefined}>
      <OrganizationJsonLd site={site} />
      <WebSiteJsonLd site={site} />
      {children}
    </MarketingShell>
  );
}
