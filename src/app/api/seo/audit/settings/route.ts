import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { auditData, saveSettings, settingsSchema } from "@/lib/seo/audit";

// PATCH /api/seo/audit/settings {auditUrl?, auditMonthly?}: which site to
// audit (it must be one of the tenant's) and the monthly re-audit.
export async function PATCH(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = settingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Check the audit settings.", { status: 400, code: "INVALID_INPUT" });
    await saveSettings({ businessId: user.businessId, userId: user.userId, name: user.name }, parsed.data);
    return { ...(await auditData(user.businessId)), canEdit: true };
  });
}
