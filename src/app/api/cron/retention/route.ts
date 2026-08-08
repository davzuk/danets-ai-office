import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { applyRetentionAll, applyScheduledDowngrades } from "@/lib/retention";

/**
 * GET /api/cron/retention
 * Scheduled retention purge + plan downgrade application.
 *
 * Requires Authorization: Bearer <CRON_SECRET>.
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
  if (secret.length < 32) {
    console.error(
      "[cron/retention] CRON_SECRET must be at least 32 characters; refusing to run"
    );
    return NextResponse.json({ error: "CRON_SECRET too short" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && (() => {
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      };
    },
    { auditLogs: 0, chatSessions: 0, leads: 0 }
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
