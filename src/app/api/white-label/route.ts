import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { sanitizeWhiteLabelCss } from "@/lib/white-label-css";

export async function GET(_req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  let config = await db.whiteLabelConfig.findUnique({ where: { businessId: user.businessId } });
  if (!config) config = await db.whiteLabelConfig.create({ data: { businessId: user.businessId } });
  return NextResponse.json({ config: { id: config.id, customDomain: config.customDomain, customLogoUrl: config.customLogoUrl, primaryColor: config.primaryColor, accentColor: config.accentColor, appName: config.appName, appShortName: config.appShortName, hideBranding: config.hideBranding, customCss: config.customCss, isActive: config.isActive } });
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
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const d = parsed.data;
  const data: any = {};
  if (d.customDomain !== undefined) data.customDomain = d.customDomain || null;
  if (d.customLogoUrl !== undefined) data.customLogoUrl = d.customLogoUrl || null;
  if (d.primaryColor) data.primaryColor = d.primaryColor;
  if (d.accentColor) data.accentColor = d.accentColor;
  if (d.appName) data.appName = d.appName.trim();
  if (d.appShortName) data.appShortName = d.appShortName.trim();
  if (d.hideBranding !== undefined) data.hideBranding = d.hideBranding;
  if (d.customCss !== undefined) {
    try {
      const sanitized = sanitizeWhiteLabelCss(d.customCss || "");
      data.customCss = sanitized || null;
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Invalid CSS" },
        { status: 400 }
      );
    }
  }
  if (d.isActive !== undefined) data.isActive = d.isActive;

  let config = await db.whiteLabelConfig.findUnique({ where: { businessId: user.businessId } });
  if (config) config = await db.whiteLabelConfig.update({ where: { id: config.id }, data });
  else config = await db.whiteLabelConfig.create({ data: { businessId: user.businessId, ...data } });

  await logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "business_settings_changed", module: "business", description: `Updated white-label configuration` });
  return NextResponse.json({ config });
}
