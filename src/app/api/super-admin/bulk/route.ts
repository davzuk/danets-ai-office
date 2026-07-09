import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { applyRetentionForBusiness, applyRetentionAll } from "@/lib/retention";

const schema = z.object({
  action: z.enum([
    "suspend_past_due",
    "activate_suspended",
    "apply_retention",
    "apply_retention_all",
  ]),
  businessIds: z.array(z.string()).optional(),
});

// POST /api/super-admin/bulk — platform bulk operations
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { action, businessIds } = parsed.data;
  const results: unknown[] = [];

  if (action === "suspend_past_due") {
    const subs = await db.businessSubscription.findMany({
      where: { status: "past_due" },
      select: { businessId: true },
    });
    const ids = businessIds?.length
      ? subs.map((s) => s.businessId).filter((id) => businessIds.includes(id))
      : subs.map((s) => s.businessId);

    if (ids.length) {
      await db.business.updateMany({
        where: { id: { in: ids } },
        data: { status: "suspended" },
      });
    }
    results.push({ suspended: ids.length, businessIds: ids });
  }

  if (action === "activate_suspended") {
    const suspended = await db.business.findMany({
      where: { status: "suspended" },
      select: { id: true },
    });
    const ids = businessIds?.length
      ? suspended.map((b) => b.id).filter((id) => businessIds.includes(id))
      : suspended.map((b) => b.id);

    if (ids.length) {
      await db.business.updateMany({
        where: { id: { in: ids } },
        data: { status: "active" },
      });
    }
    results.push({ activated: ids.length, businessIds: ids });
  }

  if (action === "apply_retention" || action === "apply_retention_all") {
    if (action === "apply_retention_all" && !businessIds?.length) {
      const allResults = await applyRetentionAll();
      results.push(...allResults);
    } else {
      const businesses = await db.business.findMany({
        where: businessIds?.length ? { id: { in: businessIds } } : undefined,
        select: { id: true },
      });

      for (const b of businesses) {
        try {
          results.push(await applyRetentionForBusiness(b.id));
        } catch {
          results.push({ businessId: b.id, error: "failed" });
        }
      }
    }
  }

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Platform Admin)`,
    action: `bulk_${action}`,
    module: "business",
    description: `Bulk operation: ${action}`,
    metadata: { action, count: results.length },
  });

  return NextResponse.json({ ok: true, action, results });
}
