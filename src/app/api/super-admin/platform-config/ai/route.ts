import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { getPlatformAiView, platformAiSchema, removePlatformAi, savePlatformAi } from "@/lib/platform-ai";

// GET /api/super-admin/platform-config/ai: the platform AI provider (key masked)
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  return NextResponse.json({ ai: await getPlatformAiView() });
}

// PUT /api/super-admin/platform-config/ai: save it (a blank key keeps the saved one)
export async function PUT(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const parsed = platformAiSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  try {
    const ai = await savePlatformAi(parsed.data, user.name);
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: `${user.name} (Platform Admin)`,
      action: "platform_config_updated",
      module: "business",
      description: `${parsed.data.enabled ? "Turned on" : "Saved (off)"} the platform AI provider: Alibaba Cloud${parsed.data.apiKey ? ", new API key" : ""}`,
      metadata: { provider: "alibaba", region: parsed.data.region, enabled: parsed.data.enabled, keyChanged: !!parsed.data.apiKey },
    });
    return NextResponse.json({ ai });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}

// DELETE /api/super-admin/platform-config/ai: forget the provider and key
export async function DELETE() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;
  const ai = await removePlatformAi();
  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: "platform_config_updated",
    module: "business",
    description: "Removed the platform AI provider (Alibaba Cloud)",
  });
  return NextResponse.json({ ai });
}
