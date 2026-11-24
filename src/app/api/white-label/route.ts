import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireReauth } from "@/lib/reauth";
import { logActivity } from "@/lib/activity";
import { sanitizeWhiteLabelCss } from "@/lib/white-label-css";
import { isAppError } from "@/lib/app-error";
import { clearWlDomain, connectWlDomain, wlDomainView } from "@/lib/white-label/domains";

export async function GET(_req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  let config = await db.whiteLabelConfig.findUnique({ where: { businessId: user.businessId } });
  if (!config) config = await db.whiteLabelConfig.create({ data: { businessId: user.businessId } });
  return NextResponse.json({ config: { id: config.id, customDomain: config.customDomain, customLogoUrl: config.customLogoUrl, primaryColor: config.primaryColor, accentColor: config.accentColor, appName: config.appName, appShortName: config.appShortName, hideBranding: config.hideBranding, customCss: config.customCss, isActive: config.isActive }, domain: wlDomainView(config) });
}

const updateSchema = z.object({
  customDomain: z.string().max(200).optional().nullable(),
  customLogoUrl: z.string().url().max(500).optional().nullable().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  appName: z.string().min(2).max(60).optional(),
  appShortName: z.string().min(2).max(20).optional(),
  hideBranding: z.boolean().optional(),
  customCss: z.string().max(10000).optional().nullable().or(z.literal("")),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  // White-label binding is a high-blast-radius action: it can bind a
  // custom domain (account takeover risk) and rewrite the entire brand.
  // Require a fresh credential within the last REAUTH_WINDOW_MINUTES.
  try {
    await requireReauth({ userId: user.userId, sessionId: user.sessionId ?? "" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Reauthentication required", code: "REAUTH_REQUIRED" },
      { status: e?.status || 401 }
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const d = parsed.data;

  const existing = await db.whiteLabelConfig.findUnique({ where: { businessId: user.businessId } });

  const data: any = {};
  if (d.customLogoUrl !== undefined) data.customLogoUrl = d.customLogoUrl || null;
  if (d.primaryColor) data.primaryColor = d.primaryColor;
  if (d.accentColor) data.accentColor = d.accentColor;
  if (d.appName) data.appName = d.appName.trim();
  if (d.appShortName) data.appShortName = d.appShortName.trim();
  if (d.hideBranding !== undefined) data.hideBranding = d.hideBranding;
  if (d.customCss !== undefined) {
    try {
      data.customCss = sanitizeWhiteLabelCss(d.customCss || "") || null;
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Invalid CSS" }, { status: 400 });
    }
  }
  if (d.isActive !== undefined) data.isActive = d.isActive;

  let config = existing ?? await db.whiteLabelConfig.create({ data: { businessId: user.businessId } });
  if (Object.keys(data).length) {
    config = await db.whiteLabelConfig.update({ where: { id: config.id }, data });
  }

  // A changed domain starts (or stops) verification.
  if (d.customDomain !== undefined) {
    const next = (d.customDomain ?? "").trim() || null;
    if (next !== (existing?.customDomain ?? null)) {
      try {
        config = next ? await connectWlDomain(user.businessId, next) : await clearWlDomain(user.businessId);
      } catch (e) {
        if (isAppError(e)) return NextResponse.json(e.toResponseBody(), { status: e.status });
        throw e;
      }
    }
  }

  await logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "business_settings_changed", module: "business", description: `Updated white-label configuration` });
  return NextResponse.json({ config: { id: config.id, customDomain: config.customDomain, customLogoUrl: config.customLogoUrl, primaryColor: config.primaryColor, accentColor: config.accentColor, appName: config.appName, appShortName: config.appShortName, hideBranding: config.hideBranding, customCss: config.customCss, isActive: config.isActive }, domain: wlDomainView(config) });
}