import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { requireReauth } from "@/lib/reauth";
import { logActivity } from "@/lib/activity";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  role: z.enum(["admin", "member"]).optional(),
  password: z.string().min(6).max(100).optional(),
  // Fresh credential the calling admin must present when changing a password.
  // Without this, a stolen super-admin session could reset any tenant user's
  // password and pivot to that account. The audit theme #2 lists this as a
  // privileged action that previously relied on requireSession alone.
  reauthPassword: z.string().min(1).optional(),
  reauthTotpCode: z.string().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/super-admin/users/[id] — update user or reset password
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user: admin } = auth;

  const { id } = await params;
  const target = await db.businessUser.findUnique({
    where: { id },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.isSuperAdmin) {
    return NextResponse.json({ error: "Cannot modify super admin users" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Password resets are the highest-blast-radius admin action — the
  // target user can be locked out or handed over to an attacker. Force
  // the calling admin to re-prove their own credential first.
  if (parsed.data.password) {
    const { verifyPlatformFreshCredential } = await import("@/lib/reauth");
    // For platform admins, the session ID comes from requireSuperAdmin's
    // resolved platform session row. For tenant super-admins, fall back
    // to the tenant session ID on the SessionUser.
    const sessionId = auth.isPlatformAdmin
      ? admin.sessionId ?? ""
      : admin.sessionId ?? "";
    if (!sessionId) {
      return NextResponse.json(
        { error: "Reauthentication requires an active session", code: "REAUTH_REQUIRED" },
        { status: 401 }
      );
    }
    try {
      await verifyPlatformFreshCredential(
        admin.userId,
        sessionId,
        {
          currentPassword: parsed.data.reauthPassword,
          totpCode: parsed.data.reauthTotpCode,
        }
      );
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Reauthentication required", code: "REAUTH_REQUIRED" },
        { status: e?.status || 401 }
      );
    }
  }

  const data: { name?: string; role?: string; password?: string } = {};
  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.password) data.password = await bcrypt.hash(parsed.data.password, 10);

  const updated = await db.businessUser.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isSuperAdmin: true,
      createdAt: true,
      businessId: true,
    },
  });

  const changes = Object.keys(parsed.data).join(", ");
  await logActivity({
    businessId: target.businessId,
    userId: admin.userId,
    userName: `${admin.name} (Super Admin)`,
    action: parsed.data.password ? "password_reset" : "user_updated",
    module: "team",
    description: `Super admin updated user ${target.email}: ${changes}`,
    metadata: { targetUserId: id, fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({
    user: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

// DELETE /api/super-admin/users/[id] — remove a user from any tenant
export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user: admin } = auth;

  const { id } = await params;
  const target = await db.businessUser.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, businessId: true, isSuperAdmin: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.isSuperAdmin) {
    return NextResponse.json({ error: "Cannot delete super admin users" }, { status: 400 });
  }

  await db.session.deleteMany({ where: { businessUserId: id } }).catch(() => {});
  await db.businessUser.delete({ where: { id } });

  await logActivity({
    businessId: target.businessId,
    userId: admin.userId,
    userName: `${admin.name} (Super Admin)`,
    action: "user_deleted",
    module: "team",
    description: `Super admin removed user ${target.email} from tenant`,
    metadata: { targetUserId: id, targetEmail: target.email },
  });

  return NextResponse.json({ ok: true });
}
