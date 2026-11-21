import { withSession } from "@/lib/api";
import { listConnectionProviders } from "@/lib/connections/registry";
import { listConnections } from "@/lib/connections/store";

// GET /api/connections — available OAuth providers + this tenant's connections (no tokens)
export function GET() {
  return withSession(async (user) => {
    const connections = await listConnections(user.businessId);
    return {
      providers: listConnectionProviders(),
      connections,
      canManage: user.role === "admin",
    };
  });
}
