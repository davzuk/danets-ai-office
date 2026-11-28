import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { PROVIDER_LABELS, isKeyedProvider } from "@/lib/llm/platform-models";
import {
  getPlatformAiView,
  modelsSchema,
  providerSchema,
  removeProviderKey,
  resetModels,
  saveModels,
  saveProvider,
} from "@/lib/platform-ai";

// GET /api/super-admin/platform-config/ai: provider keys (masked), models and defaults
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  return NextResponse.json({ ai: await getPlatformAiView() });
}

const fail = (e: unknown) => {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  throw e;
};

// PUT /api/super-admin/platform-config/ai
//   { section: "provider", provider, apiKey?, baseUrl?, region?, workspaceId? }  (a blank key keeps the saved one)
//   { section: "models", models, defaults }
//   { section: "reset-models" }
export async function PUT(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;
  const body = (await req.json().catch(() => ({}))) as { section?: string };
  const log = (description: string, metadata?: Record<string, unknown>) =>
    logActivity({ businessId: user.businessId, userId: user.userId, userName: `${user.name} (Platform Admin)`, action: "platform_config_updated", module: "business", description, metadata });

  try {
    if (body.section === "provider") {
      const parsed = providerSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
      const ai = await saveProvider(parsed.data, user.name);
      await log(`Saved the ${PROVIDER_LABELS[parsed.data.provider]} AI settings${parsed.data.apiKey ? " with a new API key" : ""}`, { provider: parsed.data.provider, keyChanged: !!parsed.data.apiKey });
      return NextResponse.json({ ai });
    }
    if (body.section === "models") {
      const parsed = modelsSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
      const ai = await saveModels(parsed.data, user.name);
      await log(`Updated the AI model list (${parsed.data.models.filter((m) => m.enabled).length} enabled)`);
      return NextResponse.json({ ai });
    }
    if (body.section === "reset-models") {
      const ai = await resetModels(user.name);
      await log("Reset the AI model list to the built-in models");
      return NextResponse.json({ ai });
    }
    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/super-admin/platform-config/ai?provider=alibaba: forget that provider's saved key
export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isKeyedProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const ai = await removeProviderKey(provider, user.name);
  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: "platform_config_updated",
    module: "business",
    description: `Removed the saved ${PROVIDER_LABELS[provider]} API key`,
  });
  return NextResponse.json({ ai });
}
