import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { connectDomain, domainView, removeDomain } from "@/lib/sites/domains";

// POST /api/site/domain {domain}: connect a custom domain (Pro+); DELETE removes it.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as { domain?: unknown } | null;
    const site = await connectDomain({ businessId: user.businessId, userId: user.userId, name: user.name }, typeof body?.domain === "string" ? body.domain : "");
    return { domain: domainView(site) };
  });
}

export async function DELETE() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await removeDomain({ businessId: user.businessId, userId: user.userId, name: user.name });
    return { domain: null };
  });
}
