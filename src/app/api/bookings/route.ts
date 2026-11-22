import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";

// GET /api/bookings?from&to&status  Bookings in a range (default: from now,
// 60 days ahead), for the Bookings list and calendar in Leads.

const MAX_RANGE_MS = 120 * 86_400_000;
const STATUSES = ["confirmed", "cancelled", "completed", "no_show"];

export async function GET(req: NextRequest) {
  return withSession(async (user) => {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") ? new Date(q.get("from")!) : new Date();
    const to = q.get("to") ? new Date(q.get("to")!) : new Date(from.getTime() + 60 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new AppError("Invalid date range.", { status: 400, code: "INVALID_INPUT" });
    }
    const statuses = (q.get("status") ?? "").split(",").filter((s) => STATUSES.includes(s));
    const [bookings, business] = await Promise.all([
      db.booking.findMany({
        where: {
          businessId: user.businessId,
          startsAt: { gte: from, lt: to },
          ...(statuses.length ? { status: { in: statuses } } : {}),
        },
        orderBy: { startsAt: q.get("order") === "desc" ? "desc" : "asc" },
        take: 500,
        include: {
          bookingType: { select: { id: true, name: true, durationMin: true, location: true, questions: true } },
          lead: { select: { id: true, name: true, status: true } },
        },
      }),
      db.business.findUnique({ where: { id: user.businessId }, select: { timezone: true } }),
    ]);
    return {
      timezone: business?.timezone ?? "UTC",
      bookings: bookings.map(({ cancelToken: _token, ...b }) => b),
    };
  });
}
