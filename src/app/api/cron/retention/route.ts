import { NextRequest, NextResponse } from "next/server";
import { applyRetentionAll } from "@/lib/retention";

/**
 * GET /api/cron/retention
 * Scheduled retention purge — requires Authorization: Bearer <CRON_SECRET>
 *
 * Configure in Vercel Cron, GitHub Actions, or any external scheduler.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this server" },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await applyRetentionAll();
  const totals = results.reduce(
    (acc, r) => {
      if ("error" in r) return acc;
      return {
        auditLogs: acc.auditLogs + r.deleted.auditLogs,
        chatSessions: acc.chatSessions + r.deleted.chatSessions,
        leads: acc.leads + r.deleted.leads,
      };
    },
    { auditLogs: 0, chatSessions: 0, leads: 0 }
  );

  return NextResponse.json({
    ok: true,
    tenantsProcessed: results.length,
    totals,
    results,
    ranAt: new Date().toISOString(),
  });
}
