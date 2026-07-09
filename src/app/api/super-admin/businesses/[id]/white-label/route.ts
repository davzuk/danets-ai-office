import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  customDomain: z.string().max(253).nullable().optional(),
  customLogoUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  appName: z.string().min(1).max(120).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  hideBranding: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// GET /api/super-admin/businesses/[id]/white-label
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  const config = await db.whiteLabelConfig.findUnique({ where: { businessId: id } });

  return NextResponse.json({
    config: config
      ? {
          customDomain: config.customDomain,
          customLogoUrl: config.customLogoUrl,
          appName: config.appName,
          primaryColor: config.primaryColor,
          hideBranding: config.hideBranding,
          isActive: config.isActive,
        }
      : null,
  });
}

// PATCH /api/super-admin/businesses/[id]/white-label — enterprise custom domain
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  const business = await db.business.findUnique({ where: { id } });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const config = await db.whiteLabelConfig.upsert({
    where: { businessId: id },
    create: {
      businessId: id,
      customDomain: data.customDomain ?? null,
      customLogoUrl: data.customLogoUrl ?? null,
      appName: data.appName ?? "Danets AI Automation",
      primaryColor: data.primaryColor ?? "#1d4ed8",
      hideBranding: data.hideBranding ?? false,
      isActive: data.isActive ?? !!data.customDomain,
    },
    update: {
      ...(data.customDomain !== undefined && { customDomain: data.customDomain }),
      ...(data.customLogoUrl !== undefined && { customLogoUrl: data.customLogoUrl }),
      ...(data.appName !== undefined && { appName: data.appName }),
      ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
      ...(data.hideBranding !== undefined && { hideBranding: data.hideBranding }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });

  return NextResponse.json({
    config: {
      customDomain: config.customDomain,
      customLogoUrl: config.customLogoUrl,
      appName: config.appName,
      primaryColor: config.primaryColor,
      hideBranding: config.hideBranding,
      isActive: config.isActive,
    },
  });
}
