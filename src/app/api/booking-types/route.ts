import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { checkQuota, requireQuota } from "@/lib/plan-quota";
import { appOrigin } from "@/lib/public-cors";
import { bookingTypeInputSchema } from "@/lib/booking/slots";

// GET/POST /api/booking-types: what visitors can book (Leads → Bookings).

export async function GET() {
  return withSession(async (user) => {
    const [types, business, users, quota] = await Promise.all([
      db.bookingType.findMany({ where: { businessId: user.businessId }, orderBy: { createdAt: "asc" } }),
      db.business.findUnique({ where: { id: user.businessId }, select: { timezone: true, publicKey: true } }),
      db.businessUser.findMany({ where: { businessId: user.businessId }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
      checkQuota(user.businessId, "bookingTypes", 0),
    ]);
    return {
      types,
      timezone: business?.timezone ?? "UTC",
      bookingBaseUrl: `${appOrigin()}/book/${business?.publicKey ?? ""}`,
      users,
      canEdit: user.role === "admin",
      limit: { used: quota.used, limit: quota.limit },
    };
  });
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = bookingTypeInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid booking type", { status: 400, code: "INVALID_INPUT" });
    }
    await requireQuota(user.businessId, "bookingTypes");
    const d = parsed.data;
    if (d.assignedUserId) {
      const member = await db.businessUser.findFirst({ where: { id: d.assignedUserId, businessId: user.businessId }, select: { id: true } });
      if (!member) throw new AppError("That team member isn't on your account.", { status: 400, code: "INVALID_INPUT" });
    }
    const taken = await db.bookingType.findUnique({ where: { businessId_slug: { businessId: user.businessId, slug: d.slug } }, select: { id: true } });
    if (taken) throw new AppError("Another booking type already uses that link.", { status: 409, code: "SLUG_TAKEN" });

    const type = await db.bookingType.create({ data: { ...d, businessId: user.businessId } });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "create",
      module: "leads",
      description: `Created booking type "${type.name}"`,
    });
    return { type };
  });
}
