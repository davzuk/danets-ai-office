import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { auditData, startAudit } from "@/lib/seo/audit";
import { enqueueAuditRun } from "@/lib/jobs/handlers/seo-audit";

// GET /api/seo/audit?auditId=: the latest (or a chosen) site audit with its
// issues grouped by kind, what changed since the previous audit, settings
// and history (SEO -> Audit).
export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const auditId = new URL(req.url).searchParams.get("auditId");
    return { ...(await auditData(user.businessId, auditId)), canEdit: user.role === "admin" };
  });
}

// POST /api/seo/audit: run an audit now (once an hour).
export async function POST() {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    await startAudit({ businessId: user.businessId, userId: user.userId, name: user.name }, "manual", enqueueAuditRun);
    return { ...(await auditData(user.businessId)), canEdit: true };
  });
}
