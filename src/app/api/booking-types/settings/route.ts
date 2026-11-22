import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { isValidTimezone } from "@/lib/content/timezone";

// PUT /api/booking-types/settings { timezone }  The business timezone that
// booking hours are in. It's the same setting the content calendar uses; it
// lives here too so tenants without the Social module can set it.
const schema = z.object({ timezone: z.string().max(64).refine(isValidTimezone, "Unknown time zone.") });

export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || "Invalid time zone.", { status: 400, code: "INVALID_INPUT" });
    const before = await db.business.findUnique({ where: { id: user.businessId }, select: { timezone: true } });
    await db.business.update({ where: { id: user.businessId }, data: { timezone: parsed.data.timezone } });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "leads",
      description: `Changed the business time zone from ${before?.timezone ?? "UTC"} to ${parsed.data.timezone}`,
    });
    return { timezone: parsed.data.timezone };
  });
}
