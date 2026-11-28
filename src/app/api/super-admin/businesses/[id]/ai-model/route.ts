import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { getTenantAiView, setTenantAiModel, tenantModelSchema } from "@/lib/tenant-ai";

type RouteCtx = { params: Promise<{ id: string }> };

const fail = (e: unknown) => {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  throw e;
};

// GET /api/super-admin/businesses/[id]/ai-model
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  try {
    return NextResponse.json({ ai: await getTenantAiView(id) });
  } catch (e) {
    return fail(e);
  }
}

// PUT { model }: set the tenant's model (within its plan, like the tenant).
export async function PUT(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { id } = await params;
  const parsed = tenantModelSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose a model." }, { status: 400 });
  try {
    const ai = await setTenantAiModel(id, parsed.data.model);
    await logActivity({
      businessId: id,
      userName: `${auth.user.name} (Super Admin)`,
      action: "business_settings_changed",
      module: "agent",
      description: parsed.data.model ? `Platform set the AI model to ${ai.options.find((o) => o.key === parsed.data.model)?.label ?? parsed.data.model}` : "Platform reset the AI model to the platform default",
    });
    return NextResponse.json({ ai });
  } catch (e) {
    return fail(e);
  }
}
