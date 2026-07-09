import { NextResponse } from "next/server";
import { getPlatformConfig, getEmailProviderInfo } from "@/lib/platform-config";

// GET /api/platform/status — public platform status for tenant app
export async function GET() {
  const config = await getPlatformConfig();
  return NextResponse.json({
    platformName: config.platformName,
    platformTagline: config.platformTagline,
    supportEmail: config.supportEmail,
    maintenanceMode: config.maintenanceMode,
    maintenanceMessage:
      config.maintenanceMessage ||
      "The platform is temporarily unavailable for scheduled maintenance. Please try again later.",
    allowPublicSignup: config.allowPublicSignup,
    defaultSignupPlan: config.defaultSignupPlan,
  });
}
