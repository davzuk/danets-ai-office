import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { AUTO_REPLY_MODES, toPublicSocialAccount } from "@/lib/social/accounts";

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    inboxEnabled: z.boolean(),
    leadSyncEnabled: z.boolean(),
    publishEnabled: z.boolean(),
    autoReply: z.enum(AUTO_REPLY_MODES),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

// PATCH /api/social-accounts/[id]: per-account toggles (admins only)
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    }
    const row = await db.socialAccount.findFirst({ where: { id, businessId: user.businessId } });
    if (!row) throw new AppError("Account not found", { status: 404, code: "NOT_FOUND" });

    const data = { ...parsed.data };
    // Lead Ads only exist on Facebook Pages.
    if (row.platform !== "facebook_page" && data.leadSyncEnabled) {
      throw new AppError("Lead sync is only available for Facebook Pages", { status: 400, code: "INVALID_REQUEST" });
    }
    const updated = await db.socialAccount.update({ where: { id: row.id }, data });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "social_account_updated",
      module: "integrations",
      description: `Updated settings for ${row.name}`,
      metadata: { socialAccountId: row.id, changes: data },
    });
    return { account: toPublicSocialAccount(updated) };
  });
}
