import "server-only";
// Shared pieces for the platform console's site builder routes
// (/api/super-admin/sites/*). Only platform admins build tenant sites.

import { NextResponse } from "next/server";
import type { LandingPage, TenantSite } from "@prisma/client";
import { db } from "@/lib/db";
import { apiHandler } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { checkQuota } from "@/lib/plan-quota";
import { isModuleEnabled } from "@/lib/module-access";
import { requireSuperAdmin, type SuperAdminUser } from "@/lib/super-admin";
import { loadContentContext } from "@/lib/content/context";
import { findPlaceholders, readBlocks, validateBlocks } from "./blocks";
import { siteOrigin, sitesDomain } from "./host";
import { appOrigin, pageConversions, pageUrl, readPageSeo, readSeoDefaults, readTheme } from "./server";
import type { Actor } from "./service";
import type { AiSpend, BuilderContext } from "./ai";

/** Run a handler as a platform admin, with the usual API error mapping. */
export async function withPlatformAdmin<T>(fn: (admin: SuperAdminUser) => Promise<T>): Promise<NextResponse> {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  return apiHandler(() => fn(auth.user));
}

/** Changes are logged on the tenant as the platform, never as a tenant user. */
export const platformActor = (admin: SuperAdminUser, businessId: string): Actor => ({ businessId, name: `${admin.name} (Platform)` });

export async function loadSite(siteId: string, admin: SuperAdminUser) {
  const site = await db.tenantSite.findUnique({ where: { id: siteId } });
  if (!site) throw new AppError("Site not found.", { status: 404, code: "NOT_FOUND" });
  return { site, actor: platformActor(admin, site.businessId) };
}

export function pageView(p: LandingPage) {
  const blocks = readBlocks(p.blocks);
  const { blocks: valid, issues } = validateBlocks(blocks);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    blocks,
    seo: readPageSeo(p.seo),
    issues,
    placeholders: findPlaceholders(blocks),
    generatedFrom: p.generatedFrom,
    // The draft differs from what visitors see.
    hasUnpublishedChanges: p.status === "published" && JSON.stringify(p.publishedBlocks ?? null) !== JSON.stringify(valid),
  };
}

/** What the editor needs to pick forms, magnets, booking types and images. */
export async function editorResources(businessId: string) {
  const [forms, magnets, bookingTypes, media] = await Promise.all([
    db.leadFormDef.findMany({ where: { businessId, status: "active" }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.leadMagnet.findMany({ where: { businessId }, select: { id: true, title: true, status: true }, orderBy: { createdAt: "desc" } }),
    db.bookingType.findMany({ where: { businessId, active: true }, select: { slug: true, name: true }, orderBy: { createdAt: "asc" } }),
    db.mediaAsset.findMany({ where: { businessId, kind: "image" }, select: { id: true, url: true, altText: true, originalName: true }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  return { forms, magnets, bookingTypes, images: media.map((m) => ({ id: m.id, url: m.url, alt: m.altText ?? m.originalName ?? "" })) };
}

/** The full editor payload for one site. */
export async function siteData(site: TenantSite) {
  const [business, quota, moduleOn, resources, pages] = await Promise.all([
    db.business.findUnique({ where: { id: site.businessId }, select: { id: true, name: true, publicKey: true, status: true } }),
    checkQuota(site.businessId, "pages", 0),
    isModuleEnabled(site.businessId, "sites"),
    editorResources(site.businessId),
    db.landingPage.findMany({
      where: { siteId: site.id },
      select: { id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, views: true, seo: true, generatedFrom: true },
      orderBy: [{ slug: "asc" }],
    }),
  ]);
  const origin = siteOrigin(site.subdomain);
  const published = pages.filter((p) => p.status === "published").map((p) => p.slug);
  const conversions = await pageConversions(site.businessId, [origin].filter((o): o is string => !!o), published);
  return {
    sitesDomain: sitesDomain(),
    appOrigin: appOrigin(),
    business,
    moduleEnabled: moduleOn,
    limit: { used: quota.used, limit: quota.limit },
    ...resources,
    site: {
      id: site.id,
      subdomain: site.subdomain,
      origin,
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
      aiGenerated: !!p.generatedFrom,
    })),
  };
}

/** Brand voice, KB facts, business profile and images, for the AI builder. */
export async function builderContext(businessId: string, prompt: string): Promise<BuilderContext> {
  const [content, business, media] = await Promise.all([
    loadContentContext(businessId, prompt),
    db.business.findUnique({ where: { id: businessId }, select: { industry: true, email: true, phone: true, whatsapp: true } }),
    db.mediaAsset.findMany({ where: { businessId, kind: "image" }, select: { url: true, altText: true, originalName: true }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return {
    ...content,
    profile: { industry: business?.industry ?? null, email: business?.email ?? null, phone: business?.phone ?? null, whatsapp: business?.whatsapp ?? null },
    // Short ids keep the prompt small and stop the model inventing ids.
    images: media.map((m, i) => ({ id: `img${i + 1}`, url: m.url, description: (m.altText || m.originalName || "image").slice(0, 120) })),
  };
}

/**
 * The platform pays for builder calls (its own provider), so they don't use
 * the tenant's AI quota. The spend is still recorded on the tenant's activity
 * log so it can be traced.
 */
export async function recordAiSpend(a: Actor, what: string, spend: AiSpend, metadata: Record<string, unknown> = {}) {
  if (!spend.calls) return;
  await logActivity({
    businessId: a.businessId,
    userName: a.name,
    action: "ai_generate",
    module: "sites",
    description: what,
    metadata: { ...metadata, aiCalls: spend.calls, promptTokens: spend.promptTokens, completionTokens: spend.completionTokens, model: spend.model, provider: spend.provider, billedTo: "platform" },
  });
}
