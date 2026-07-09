import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { startImpersonation } from "@/lib/auth";
import { startPlatformImpersonation } from "@/lib/platform-auth";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  userId: z.string().min(1),
  businessId: z.string().min(1),
});

// POST /api/super-admin/impersonate — log in as a tenant user for support
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user: admin, isPlatformAdmin } = auth;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const target = await db.businessUser.findUnique({
    where: { id: parsed.data.userId },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!target || target.businessId !== parsed.data.businessId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.isSuperAdmin) {
    return NextResponse.json({ error: "Cannot impersonate super admin users" }, { status: 400 });
  }

  try {
    if (isPlatformAdmin) {
      await startPlatformImpersonation(parsed.data.userId, parsed.data.businessId);
    } else {
      await startImpersonation(parsed.data.userId, parsed.data.businessId);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "CANNOT_IMPERSONATE_SUPER_ADMIN") {
      return NextResponse.json({ error: "Cannot impersonate super admin users" }, { status: 400 });
    }
    if (msg === "NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actorLabel = isPlatformAdmin ? "Platform Admin" : "Super Admin";
  await logActivity({
    businessId: target.businessId,
    userId: admin.userId,
    userName: `${admin.name} (${actorLabel})`,
    action: "impersonation_started",
    module: "auth",
    description: `${actorLabel} started impersonating ${target.email} at ${target.business.name}`,
    metadata: { targetUserId: target.id, targetEmail: target.email, adminEmail: admin.email },
  });

  return NextResponse.json({
    user: {
      userId: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      businessId: target.businessId,
      businessName: target.business.name,
      isSuperAdmin: false,
      isImpersonating: true,
    },
  });
}
