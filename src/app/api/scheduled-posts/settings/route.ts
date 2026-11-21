import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { APPROVAL_POLICIES, normalizePolicy, approvalRequired } from "@/lib/content/approval";
import { parseBody } from "@/lib/content/posts";
import { PUBLISH_ACCOUNT_PLATFORM } from "@/lib/content/schedule";
import { isValidTimezone } from "@/lib/content/timezone";

const updateSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimezone, "Unknown time zone.").optional(),
  contentApproval: z.enum(APPROVAL_POLICIES).optional(),
});

async function load(businessId: string) {
  const [business, teamSize, accounts] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { timezone: true, contentApproval: true } }),
    db.businessUser.count({ where: { businessId } }),
    db.socialAccount.findMany({
      where: { businessId, platform: { in: Object.values(PUBLISH_ACCOUNT_PLATFORM) } },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
      select: { id: true, platform: true, name: true, username: true, status: true, publishEnabled: true, lastError: true },
    }),
  ]);
  const policy = normalizePolicy(business?.contentApproval);
  return {
    timezone: business?.timezone || "UTC",
    contentApproval: policy,
    approvalRequired: approvalRequired(policy, teamSize),
    teamSize,
    // Accounts that can publish each content platform automatically.
    accounts: accounts.map((a) => ({ ...a, usable: a.status === "active" && a.publishEnabled })),
    autoPlatforms: Object.keys(PUBLISH_ACCOUNT_PLATFORM),
  };
}

// GET /api/scheduled-posts/settings: time zone, approval policy and publishable accounts
export function GET() {
  return withSession(async (user) => ({ ...(await load(user.businessId)), canManage: user.role === "admin" }));
}

// PUT /api/scheduled-posts/settings { timezone?, contentApproval? } (admins)
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const input = await parseBody(req, updateSchema);
    await db.business.update({
      where: { id: user.businessId },
      data: {
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.contentApproval ? { contentApproval: input.contentApproval } : {}),
      },
    });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "content.settings_updated",
      module: "social",
      description: "Updated publishing settings",
      metadata: input,
    });
    return { ...(await load(user.businessId)), canManage: true };
  });
}
