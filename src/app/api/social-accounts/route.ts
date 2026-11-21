import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { toPublicSocialAccount } from "@/lib/social/accounts";

// GET /api/social-accounts: this tenant's connected Pages / IG accounts (no tokens)
export function GET() {
  return withSession(async (user) => {
    const rows = await db.socialAccount.findMany({
      where: { businessId: user.businessId },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
    });
    return { accounts: rows.map(toPublicSocialAccount), canManage: user.role === "admin" };
  });
}
