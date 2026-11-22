import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { checkQuota } from "@/lib/plan-quota";
import { customDomainOrigin, siteOrigin, sitesDomain } from "@/lib/sites/host";
import { isModuleEnabled } from "@/lib/module-access";
import { domainView } from "@/lib/sites/domains";
import { siteSeoDefaultsSchema, siteThemeSchema } from "@/lib/sites/blocks";
import { appOrigin, pageConversions, pageUrl, readPageSeo, readSeoDefaults, readTheme } from "@/lib/sites/server";
import { assertSubdomainFree, availableSubdomain, createSite } from "@/lib/sites/service";

// /api/site: the tenant's website (the "sites" module). GET returns the site
// and its pages with stats; POST sets the site up; PATCH changes settings.

export async function GET() {
  return withSession(async (user) => {
    const [site, business, quota, bookingTypes] = await Promise.all([
      db.tenantSite.findUnique({ where: { businessId: user.businessId } }),
      db.business.findUnique({ where: { id: user.businessId }, select: { name: true, publicKey: true } }),
      checkQuota(user.businessId, "pages", 0),
      db.bookingType.findMany({ where: { businessId: user.businessId, active: true }, select: { slug: true, name: true }, orderBy: { createdAt: "asc" } }),
    ]);
    const common = {
      canEdit: user.role === "admin",
      sitesConfigured: !!sitesDomain(),
      sitesDomain: sitesDomain(),
      businessName: business?.name ?? "",
      publicKey: business?.publicKey ?? "",
      appOrigin: appOrigin(),
      bookingTypes,
      limit: { used: quota.used, limit: quota.limit },
    };
    if (!site) return { ...common, site: null, pages: [], suggestedSubdomain: await availableSubdomain(business?.name ?? "site") };

    const subOrigin = siteOrigin(site.subdomain);
    const domainAllowed = await isModuleEnabled(user.businessId, "sites_domain");
    const customOrigin = domainAllowed && site.domainStatus === "verified" && site.customDomain ? customDomainOrigin(site.customDomain) : null;
    const origin = customOrigin ?? subOrigin;
    const pages = await db.landingPage.findMany({
      where: { siteId: site.id },
      select: { id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, views: true, seo: true },
      orderBy: [{ slug: "asc" }],
    });
    const published = pages.filter((p) => p.status === "published").map((p) => p.slug);
    const conversions = await pageConversions(user.businessId, [subOrigin, customOrigin].filter((o): o is string => !!o), published);
    return {
      ...common,
      site: {
        id: site.id,
        subdomain: site.subdomain,
        origin,
        subdomainOrigin: subOrigin,
        domainAllowed,
        domain: domainView(site),
        status: site.status,
        theme: readTheme(site.theme) ?? {},
        seoDefaults: readSeoDefaults(site.seoDefaults) ?? {},
        widgetEnabled: site.widgetEnabled,
      },
      pages: pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        status: p.status,
        publishedAt: p.publishedAt,
        updatedAt: p.updatedAt,
        views: p.views,
        conversions: conversions.get(p.slug) ?? 0,
        url: origin ? pageUrl(origin, p.slug) : null,
        hideFromNav: !!readPageSeo(p.seo).hideFromNav,
      })),
    };
  });
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    if (!sitesDomain()) throw new AppError("Websites aren't available on this server yet.", { status: 503, code: "SITES_NOT_CONFIGURED" });
    const body = (await req.json().catch(() => null)) as { subdomain?: unknown } | null;
    const subdomain = typeof body?.subdomain === "string" ? body.subdomain.trim().toLowerCase() : "";
    const business = await db.business.findUnique({ where: { id: user.businessId }, select: { name: true } });
    const site = await createSite({ businessId: user.businessId, userId: user.userId, name: user.name }, subdomain, business?.name ?? "Our business");
    return { site: { id: site.id, subdomain: site.subdomain, origin: siteOrigin(site.subdomain) } };
  });
}

const patchSchema = z.object({
  subdomain: z.string().trim().toLowerCase().optional(),
  theme: siteThemeSchema.optional(),
  seoDefaults: siteSeoDefaultsSchema.optional(),
  widgetEnabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid settings", { status: 400, code: "INVALID_INPUT" });
    const site = await db.tenantSite.findUnique({ where: { businessId: user.businessId } });
    if (!site) throw new AppError("Set up your website first.", { status: 404, code: "NO_SITE" });
    const d = parsed.data;
    const moved = d.subdomain !== undefined && d.subdomain !== site.subdomain;
    if (moved) await assertSubdomainFree(d.subdomain!, site.id);
    const updated = await db.tenantSite.update({
      where: { id: site.id },
      data: {
        ...(moved ? { subdomain: d.subdomain } : {}),
        ...(d.theme !== undefined ? { theme: d.theme } : {}),
        ...(d.seoDefaults !== undefined ? { seoDefaults: d.seoDefaults } : {}),
        ...(d.widgetEnabled !== undefined ? { widgetEnabled: d.widgetEnabled } : {}),
      },
    });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "sites",
      description: moved ? `Moved the website to ${siteOrigin(updated.subdomain) ?? updated.subdomain}` : "Updated website settings",
    });
    return { site: { id: updated.id, subdomain: updated.subdomain, origin: siteOrigin(updated.subdomain) } };
  });
}
