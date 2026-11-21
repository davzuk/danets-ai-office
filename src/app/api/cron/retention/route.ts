import { NextResponse } from "next/server";
import { applyRetentionAll, applyScheduledDowngrades } from "@/lib/retention";
import { verifyCronRequest } from "@/lib/cron-secret";

/**
 * GET /api/cron/retention
 * Scheduled retention purge + plan downgrade application.
 *
 * Requires Authorization: Bearer <CRON_SECRET>.
 *
 * The length + constant-time bearer check is delegated to
 * `verifyCronRequest` so all cron endpoints share one policy and the
 * startup-time warning fires from a single import point.
 */
export async function GET(req: Request) {
  const auth = await verifyCronRequest(req);
  if (!auth.ok) return auth.response;

  const [results, downgrades] = await Promise.all([
    applyRetentionAll(),
    applyScheduledDowngrades(),
  ]);
  const totals = results.reduce(
    (acc, r) => {
      if ("error" in r) return acc;
      return {
        auditLogs: acc.auditLogs + r.deleted.auditLogs,
        chatSessions: acc.chatSessions + r.deleted.chatSessions,
        leads: acc.leads + r.deleted.leads,
        touchpoints: acc.touchpoints + r.deleted.touchpoints,
      };
    },
    { auditLogs: 0, chatSessions: 0, leads: 0, touchpoints: 0 }
  );

  return NextResponse.json({
    ok: true,
    tenantsProcessed: results.length,
    totals,
    results,
    downgradesApplied: downgrades.applied.length,
    downgrades,
    ranAt: new Date().toISOString(),
  });
}
