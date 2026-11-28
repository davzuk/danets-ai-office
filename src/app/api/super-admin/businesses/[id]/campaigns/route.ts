import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@/lib/app-error";
import { checkQuota, LimitExceededError } from "@/lib/plan-quota";
import { CAMPAIGN_STATUSES, updateCampaignSchema } from "@/lib/campaigns/rules";
import { linkAsset, listCampaigns, rematchTouches, updateCampaign, type CampaignActor } from "@/lib/campaigns/service";

type Ctx = { params: Promise<{ id: string }> };

async function view(businessId: string) {
  // Listing first: it may turn old post tags into campaigns, which count toward the limit.
  const campaigns = await listCampaigns(businessId, { includeArchived: true });
  const [pages, quota] = await Promise.all([
    db.landingPage.findMany({
      where: { businessId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, slug: true, status: true, campaignId: true, site: { select: { subdomain: true } } },
    }),
    checkQuota(businessId, "campaigns", 0),
  ]);
  return {
    campaigns,
    pages: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, campaignId: p.campaignId, subdomain: p.site.subdomain })),
    limit: { used: quota.used, limit: quota.limit },
  };
}

// GET: the tenant's campaigns (archived included) and its platform-built pages.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  if (!(await db.business.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  return NextResponse.json(await view(id));
}

const bodySchema = z.discriminatedUnion("action", [
  // Link a platform-built page to a campaign (campaignId null = unlink from its campaign).
  z.object({ action: z.literal("link_page"), pageId: z.string().min(1).max(64), campaignId: z.string().min(1).max(64).nullable() }),
  z.object({ action: z.literal("status"), campaignId: z.string().min(1).max(64), status: z.enum(CAMPAIGN_STATUSES) }),
  // Re-link the last 90 days' unmatched touches now (normally nightly).
  z.object({ action: z.literal("rematch") }),
]);

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  if (!(await db.business.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const actor: CampaignActor = { businessId: id, name: `${auth.user.name} (Super Admin)`, role: "admin", platform: true };
  const body = parsed.data;
  try {
    let matched: number | undefined;
    if (body.action === "link_page") {
      if (body.campaignId) {
        await linkAsset(actor, body.campaignId, { type: "page", id: body.pageId, linked: true });
      } else {
        const page = await db.landingPage.findFirst({ where: { id: body.pageId, businessId: id }, select: { campaignId: true } });
        if (!page) throw new AppError("Page not found.", { status: 404, code: "NOT_FOUND" });
        if (page.campaignId) await linkAsset(actor, page.campaignId, { type: "page", id: body.pageId, linked: false });
      }
    } else if (body.action === "status") {
      await updateCampaign(actor, body.campaignId, updateCampaignSchema.parse({ status: body.status }));
    } else {
      matched = await rematchTouches(id, 90);
    }
    return NextResponse.json({ ...(await view(id)), ...(matched !== undefined ? { matched } : {}) });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    if (e instanceof LimitExceededError) return NextResponse.json({ error: "The tenant is at its campaign limit." }, { status: 403 });
    throw e;
  }
}
