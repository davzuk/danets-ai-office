import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/super-admin";
import {
  getPlatformConfig,
  getPlatformSetupStatus,
  getEmailProviderInfo,
  updatePlatformConfig,
} from "@/lib/platform-config";
import { logActivity } from "@/lib/activity";

// GET /api/super-admin/platform-config — platform-wide settings + setup status
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const includeStatus = req.nextUrl.searchParams.get("status") === "1";

  const config = await getPlatformConfig();
  const email = getEmailProviderInfo();

  const body: Record<string, unknown> = {
    config,
    email,
  };

  if (includeStatus) {
    body.setup = await getPlatformSetupStatus();
  }

  return NextResponse.json(body);
}

const patchSchema = z.object({
  platformName: z.string().min(2).max(120).optional(),
  platformTagline: z.string().max(200).optional(),
  supportEmail: z.union([z.string().email(), z.literal("")]).nullable().optional(),
  supportPhone: z.string().max(40).nullable().optional(),
  defaultSignupPlan: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().max(500).nullable().optional(),
  emailFromName: z.string().min(1).max(80).optional(),
  emailFromAddress: z.union([z.string().email(), z.literal("")]).nullable().optional(),
  allowPublicSignup: z.boolean().optional(),
  enforcePlatform2fa: z.boolean().optional(),
});

// PATCH /api/super-admin/platform-config
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const config = await updatePlatformConfig({
    ...data,
    supportEmail: data.supportEmail === "" ? null : data.supportEmail,
    emailFromAddress: data.emailFromAddress === "" ? null : data.emailFromAddress,
  });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: "platform_config_updated",
    module: "business",
    description: "Updated platform configuration",
    metadata: { fields: Object.keys(data) },
  });

  return NextResponse.json({ config, setup: await getPlatformSetupStatus() });
}
