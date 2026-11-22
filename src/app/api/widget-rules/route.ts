import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { MAX_RULES, widgetRuleInputSchema } from "@/lib/widget-rules";

// GET/POST /api/widget-rules: the tenant's proactive widget messages.
// Gated to Starter+ by the "proactive_messages" module (see module-registry).

export async function GET() {
  return withSession(async (user) => {
    const rules = await db.widgetRule.findMany({
      where: { businessId: user.businessId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    return { rules, max: MAX_RULES, canEdit: user.role === "admin" };
  });
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = widgetRuleInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid rule", { status: 400, code: "INVALID_INPUT" });
    }
    const count = await db.widgetRule.count({ where: { businessId: user.businessId } });
    if (count >= MAX_RULES) {
      throw new AppError(`You can have up to ${MAX_RULES} proactive messages.`, { status: 409, code: "LIMIT_REACHED" });
    }
    const rule = await db.widgetRule.create({ data: { businessId: user.businessId, ...parsed.data } });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "create",
      module: "agent",
      description: `Created proactive message "${rule.name}"`,
    });
    return { rule };
  });
}
