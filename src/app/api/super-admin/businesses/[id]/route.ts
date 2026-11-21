import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { purgeBusinessMedia } from "@/lib/media";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { getTenantUsage } from "@/lib/tenant-usage";
import { applyPlanTransition, validatePlanTransition } from "@/lib/plan-transitions";

const patchSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
  name: z.string().min(2).max(120).optional(),
  // Tenant-level 2FA policy: when true, every member of this business is
  // required to use TOTP on sign-in. Mirrors the tenant-side toggle at
  // /api/business (admin-only) but is privileged to platform operators.
  enforce2fa: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/super-admin/businesses/[id] — detailed business view
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { id } = await params;
  const business = await db.business.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, isSuperAdmin: true, createdAt: true } },
      subscription: true,
      limitOverride: true,
      _count: {
        select: {
          leads: true,
          chatSessions: true,
          supportTickets: true,
          quoteRequests: true,
          knowledgeBaseItems: true,
          documents: true,
          usageLogs: true,
        },
      },
    },
  });

  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Normalize subscription fields so the Super Admin UI receives a stable
  // shape regardless of the underlying BusinessSubscription column names.
  const { subscription: rawSub, ...rest } = business;
  const subscription = rawSub
    ? {
        id: rawSub.id,
        plan: rawSub.planName,
        status: rawSub.status,
        monthlyFee: rawSub.monthlyFee,
        startDate: rawSub.startDate.toISOString(),
        endDate: rawSub.endDate?.toISOString() || null,
        trialEndsAt: rawSub.trialEndsAt?.toISOString() || null,
        paymentMethod: rawSub.paymentMethod,
        paymentRef: rawSub.paymentRef,
        downgradeScheduledFor: rawSub.downgradeScheduledFor?.toISOString() || null,
        downgradeTargetPlan: rawSub.downgradeTargetPlan ?? null,
        // UI-friendly aliases
        currentPeriodEnd: rawSub.endDate?.toISOString() || null,
        cancelAtPeriodEnd: rawSub.status === "canceled",
      }
    : null;

  const usage = await getTenantUsage(id, business.plan);

  return NextResponse.json({ business: { ...rest, subscription, usage } });
}

// PATCH /api/super-admin/businesses/[id] — update business status/plan
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const { id } = await params;
  const business = await db.business.findUnique({ where: { id } });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: any = {};
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.plan) data.plan = parsed.data.plan;
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.enforce2fa !== undefined) data.enforce2fa = parsed.data.enforce2fa;

  // When a plan change is requested, validate the transition first — the
  // same rules apply to super-admin actions as to tenant self-service.
  if (parsed.data.plan && parsed.data.plan !== business.plan) {
    const validation = await validatePlanTransition(id, parsed.data.plan, business.plan);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.reason,
          conflicts: validation.conflicts,
        },
        { status: 409 }
      );
    }
    const applied = await applyPlanTransition(id, business.plan, parsed.data.plan, {
      userId: user.userId,
      name: `${user.name} (Super Admin)`,
      isSuperAdmin: true,
    });
    if (!applied.ok) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }
    // Mark Business.plan so quota reads pick up the target. For downgrades
    // this is a no-op (BusinessSubscription retains the current plan).
    if (!applied.scheduled) {
      data.plan = parsed.data.plan;
    }
  }

  // Run business + subscription sync inside a transaction so plan changes
  // stay consistent across Business.plan and BusinessSubscription.planName.
  const updated = await db.$transaction(async (tx) => {
    return tx.business.update({ where: { id }, data });
  });

  // Log to the business's audit log
  await logActivity({
    businessId: id,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "business_settings_changed",
    module: "business",
    description: `Super admin updated business: ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  });

  return NextResponse.json({ business: updated });
}

// DELETE /api/super-admin/businesses/[id] — permanently delete a tenant
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const { id } = await params;
  const business = await db.business.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, email: true, isSuperAdmin: true } },
    },
  });
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (business.users.some((u) => u.isSuperAdmin)) {
    return NextResponse.json(
      { error: "Cannot delete a tenant that contains super admin users" },
      { status: 400 }
    );
  }

  // Stored files are outside the DB cascade: remove them first.
  await purgeBusinessMedia(id);
  await db.business.delete({ where: { id } });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "tenant_deleted",
    module: "business",
    description: `Super admin deleted tenant "${business.name}" (${business.id})`,
    metadata: { deletedBusinessId: id, deletedBusinessName: business.name },
  });

  return NextResponse.json({ ok: true });
}
