import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSession, destroySession } from "@/lib/auth";
import { verifyTotpCode, consumeBackupCode } from "@/lib/totp";
import { logActivity } from "@/lib/activity";

const SOFT_DELETE_COOLDOWN_DAYS = 7;

const deleteSchema = z.object({
  confirm: z.literal("DELETE ALL MY DATA"),
  currentPassword: z.string().min(1),
  // TOTP code is required if the user has 2FA enabled. Backup codes (8 chars)
  // are also accepted so a lost device doesn't trap the account owner.
  totpCode: z
    .string()
    .regex(/^(\d{6}|\d{8}|[a-z0-9]{8})$/i)
    .optional(),
});

/**
 * GDPR delete — soft-delete with a 7-day cooling-off window.
 *
 * Why soft-delete:
 *   1. A single CSRF bypass or stolen session must NOT be able to detonate
 *      the entire tenant. Soft-delete gives support a recovery path and
 *      the customer a 7-day cooling-off window.
 *   2. The hard delete (`db.business.delete`) cascades through every
 *      BusinessUser, Lead, ChatSession, Payment, Integration. There's no
 *      undo. soft-delete is reversible until purge.
 *
 * Why re-auth:
 *   The audit identified this endpoint as a high-blast-radius action gated
 *   only by `requireSession()`. We now require the user's *current*
 *   password and (if enabled) a fresh TOTP or backup code. The existing
 *   session cookie is not sufficient.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Confirmation, current password, and (if enabled) a 2FA code are all required.",
      },
      { status: 400 }
    );
  }

  // Refuse if currently impersonating — the impersonator session must not
  // be able to delete the target tenant.
  if (user.isImpersonating) {
    return NextResponse.json(
      { error: "Cannot delete while impersonating" },
      { status: 403 }
    );
  }

  // Refuse if the tenant's policy requires 2FA but this user has it off —
  // they must enable it (or have an admin disable the policy) before they
  // can perform a high-blast-radius action.
  const row = await db.businessUser.findUnique({
    where: { id: user.userId },
    include: { business: true },
  });
  if (!row || !row.password) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (row.business.enforce2fa && !row.totpEnabled) {
    return NextResponse.json(
      { error: "2FA must be enabled before you can delete this tenant" },
      { status: 403 }
    );
  }

  // Fresh credential check.
  const passwordOk = await bcrypt.compare(parsed.data.currentPassword, row.password);
  if (!passwordOk) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 }
    );
  }

  if (row.totpEnabled) {
    if (!parsed.data.totpCode) {
      return NextResponse.json(
        { error: "2FA code required" },
        { status: 401 }
      );
    }
    let verified = false;
    if (row.totpSecret) {
      verified = await verifyTotpCode(row.totpSecret, parsed.data.totpCode);
    }
    if (!verified && row.totpBackupCodes) {
      verified = await consumeBackupCode(
        row.id,
        parsed.data.totpCode,
        row.totpBackupCodes
      );
    }
    if (!verified) {
      return NextResponse.json(
        { error: "Invalid 2FA code" },
        { status: 401 }
      );
    }
  }

  const now = new Date();
  const purgeAt = new Date(now);
  purgeAt.setDate(purgeAt.getDate() + SOFT_DELETE_COOLDOWN_DAYS);

  // Atomic flip. If a concurrent request already soft-deleted, this is a
  // no-op and we return the same 200 — idempotent.
  const updated = await db.business.updateMany({
    where: { id: user.businessId, deletedAt: null },
    data: {
      status: "deleted",
      deletedAt: now,
      purgeScheduledAt: purgeAt,
    },
  });

  if (updated.count > 0) {
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "tenant_scheduled_for_purge",
      module: "gdpr",
      description: `Tenant soft-deleted by user; hard purge scheduled for ${purgeAt.toISOString()}`,
      metadata: { purgeScheduledAt: purgeAt.toISOString() },
    });
  }

  await destroySession();

  return NextResponse.json({
    success: true,
    message: `Your tenant has been scheduled for permanent deletion in ${SOFT_DELETE_COOLDOWN_DAYS} days. Contact support within that window to cancel.`,
    purgeScheduledAt: purgeAt.toISOString(),
  });
}