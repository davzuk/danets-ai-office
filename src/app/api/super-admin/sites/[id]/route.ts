import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { siteOrigin } from "@/lib/sites/host";
import { siteSeoDefaultsSchema, siteThemeSchema } from "@/lib/sites/blocks";
import { assertSubdomainFree } from "@/lib/sites/service";
import { loadSite, siteData, withPlatformAdmin } from "@/lib/sites/platform";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/super-admin/sites/<id>: the site builder's data for one tenant site.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const { site } = await loadSite((await params).id, admin);
    return siteData(site);
  });
}

const schema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  reason: z.string().trim().max(300).optional(),
  subdomain: z.string().trim().toLowerCase().optional(),
  theme: siteThemeSchema.optional(),
  seoDefaults: siteSeoDefaultsSchema.optional(),
  widgetEnabled: z.boolean().optional(),
});

// PATCH /api/super-admin/sites/<id>: settings (address, theme, SEO, widget),
// or {status} to take a tenant's website offline or bring it back online.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withPlatformAdmin(async (admin) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid input", { status: 400, code: "INVALID_INPUT" });
    const { site, actor } = await loadSite((await params).id, admin);
    const d = parsed.data;
    const moved = d.subdomain !== undefined && d.subdomain !== site.subdomain;
    if (moved) await assertSubdomainFree(d.subdomain!, site.id);
    const updated = await db.tenantSite.update({
      where: { id: site.id },
      data: {
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(moved ? { subdomain: d.subdomain } : {}),
        ...(d.theme !== undefined ? { theme: d.theme } : {}),
        ...(d.seoDefaults !== undefined ? { seoDefaults: d.seoDefaults } : {}),
        ...(d.widgetEnabled !== undefined ? { widgetEnabled: d.widgetEnabled } : {}),
      },
    });
    if (site.status !== updated.status) {
      await logActivity({
        businessId: site.businessId,
        userName: actor.name,
        action: updated.status === "suspended" ? "site_suspended" : "site_restored",
        module: "sites",
        description:
          updated.status === "suspended"
            ? `Website ${site.subdomain} suspended by the platform${d.reason ? `: ${d.reason}` : ""}`
            : `Website ${site.subdomain} brought back online by the platform`,
        metadata: { siteId: site.id, reason: d.reason ?? null },
      });
    }
    if (moved || d.theme !== undefined || d.seoDefaults !== undefined || d.widgetEnabled !== undefined) {
      await logActivity({
        businessId: site.businessId,
        userName: actor.name,
        action: "update",
        module: "sites",
        description: moved ? `Moved the website to ${siteOrigin(updated.subdomain) ?? updated.subdomain}` : "Updated website settings",
      });
    }
    return { site: { id: updated.id, status: updated.status, subdomain: updated.subdomain, origin: siteOrigin(updated.subdomain) } };
  });
}
