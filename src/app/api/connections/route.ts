import { withSession } from "@/lib/api";
import { listConnectionProviders } from "@/lib/connections/registry";
import { listConnections } from "@/lib/connections/store";
import { db } from "@/lib/db";
import { toPublicSocialAccount } from "@/lib/social/accounts";

// GET /api/connections — available OAuth providers + this tenant's connections and social accounts (no tokens)
export function GET() {
  return withSession(async (user) => {
    const [connections, socialAccounts] = await Promise.all([
      listConnections(user.businessId),
      db.socialAccount.findMany({ where: { businessId: user.businessId }, orderBy: [{ platform: "asc" }, { name: "asc" }] }),
    ]);
    return {
      providers: listConnectionProviders(),
      connections,
      socialAccounts: socialAccounts.map(toPublicSocialAccount),
      canManage: user.role === "admin",
    };
  });
}
