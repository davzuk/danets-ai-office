import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { listSchedules } from "@/lib/content/schedule";

const MAX_RANGE_MS = 62 * 24 * 60 * 60_000;

// GET /api/scheduled-posts?from=ISO&to=ISO: the calendar's window (cancelled ones left out)
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") ? new Date(sp.get("from")!) : new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const to = sp.get("to") ? new Date(sp.get("to")!) : new Date(from.getTime() + 35 * 24 * 60 * 60_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new AppError("Invalid date range.", { status: 400, code: "BAD_RANGE" });
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new AppError("Pick a shorter date range.", { status: 400, code: "RANGE_TOO_LONG" });
    return { schedules: await listSchedules(user.businessId, { from, to }), canApprove: user.role === "admin" };
  });
}
