import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { widgetRuleInputSchema } from "@/lib/widget-rules";

type Ctx = { params: Promise<{ id: string }> };

// A full edit, or just { enabled } from the list switch. "resetStats" zeroes the counters.
const patchSchema = z.union([
  widgetRuleInputSchema.extend({ resetStats: z.boolean().optional() }),
  z.object({ enabled: z.boolean() }).strict(),
]);

async function ownRule(businessId: string, id: string) {
  const rule = await db.widgetRule.findFirst({ where: { id, businessId } });
  if (!rule) throw new AppError("Proactive message not found.", { status: 404, code: "NOT_FOUND" });
  return rule;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const before = await ownRule(user.businessId, id);
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid rule", { status: 400, code: "INVALID_INPUT" });
    }
    const { resetStats, ...data } = parsed.data as z.infer<typeof patchSchema> & { resetStats?: boolean };
    const rule = await db.widgetRule.update({
      where: { id: before.id },
      data: { ...data, ...(resetStats ? { shows: 0, chats: 0, leads: 0 } : {}) },
    });
    const onlyToggle = Object.keys(data).length === 1 && "enabled" in data;
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "agent",
      description: onlyToggle
        ? `${rule.enabled ? "Turned on" : "Turned off"} proactive message "${rule.name}"`
        : `Updated proactive message "${rule.name}"${resetStats ? " and reset its stats" : ""}`,
    });
    return { rule };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const rule = await ownRule(user.businessId, id);
    await db.widgetRule.delete({ where: { id: rule.id } });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "delete",
      module: "agent",
      description: `Deleted proactive message "${rule.name}"`,
    });
    return { ok: true };
  });
}
