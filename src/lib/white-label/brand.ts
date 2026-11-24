import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { normalizeCustomDomain } from "@/lib/sites/host";
import type { Brand } from "./types";

/**
 * The active, verified white-label brand for a request host, or null when the
 * host is the platform's (or the tenant hasn't verified a domain). Verified
 * means ownership was proven with the TXT record, so the app can safely serve
 * a tenant's login and dashboard there.
 */
export const getBrandByHost = cache(async (rawHost: string | null | undefined): Promise<Brand | null> => {
  if (!rawHost) return null;
  const host = normalizeCustomDomain(rawHost);
  if (!host) return null;
  const cfg = await db.whiteLabelConfig.findFirst({
    where: { customDomain: host, isActive: true, domainStatus: "verified" },
    select: { appName: true, appShortName: true, primaryColor: true, accentColor: true, customLogoUrl: true, hideBranding: true, customCss: true },
  });
  if (!cfg) return null;
  return { ...cfg };
});

export async function readBrand(): Promise<Brand | null> {
  const h = await headers();
  return getBrandByHost(h.get("host"));
}