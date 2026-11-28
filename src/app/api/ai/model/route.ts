import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { AppError } from "@/lib/app-error";
import { getTenantAiView, setTenantAiModel, tenantModelSchema } from "@/lib/tenant-ai";

// GET /api/ai/model: the models this tenant can pick, and what it uses now.
export async function GET() {
  return withSession(async (user) => ({ ...(await getTenantAiView(user.businessId)), canEdit: user.role === "admin" }));
}

// PUT { model: "provider:model" | null }: pick a model (admins). Null = platform default.
export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new AppError("Only admins can change the AI model.", { status: 403, code: "FORBIDDEN" });
    const parsed = tenantModelSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError("Choose a model.", { status: 400, code: "INVALID" });
    const view = await setTenantAiModel(user.businessId, parsed.data.model);
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "business_settings_changed",
      module: "agent",
      description: parsed.data.model ? `Switched the AI model to ${view.effective.label}` : "Switched the AI model back to the platform default",
    });
    return { ...view, canEdit: true };
  });
}
