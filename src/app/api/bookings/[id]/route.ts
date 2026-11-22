import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { BookingError, cancelBooking } from "@/lib/booking/service";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/bookings/:id  Cancel (emails the visitor), or after it starts,
// mark it completed or a no-show.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("no_show") }),
]);

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const booking = await db.booking.findFirst({ where: { id, businessId: user.businessId }, include: { bookingType: { select: { name: true } } } });
    if (!booking) throw new AppError("Booking not found.", { status: 404, code: "NOT_FOUND" });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Invalid request.", { status: 400, code: "INVALID_INPUT" });
    const d = parsed.data;
    const typeName = booking.bookingType?.name ?? "booking";

    if (d.action === "cancel") {
      try {
        const updated = await cancelBooking({ id: booking.id }, "business", d.reason, { id: user.userId, name: user.name });
        await logActivity({
          businessId: user.businessId,
          userId: user.userId,
          userName: user.name,
          action: "update",
          module: "leads",
          description: `Cancelled ${booking.name}'s ${typeName}`,
        });
        return { booking: { ...updated, cancelToken: undefined } };
      } catch (e) {
        if (e instanceof BookingError) throw new AppError(e.message, { status: 400, code: e.code });
        throw e;
      }
    }

    if (booking.startsAt.getTime() > Date.now()) {
      throw new AppError("You can mark a booking completed or a no-show once it has started.", { status: 400, code: "NOT_STARTED" });
    }
    if (booking.status === "cancelled") throw new AppError("This booking was cancelled.", { status: 400, code: "INVALID" });
    const status = d.action === "complete" ? "completed" : "no_show";
    const updated = await db.booking.update({ where: { id: booking.id }, data: { status } });
    if (booking.leadId) {
      await db.leadActivity.create({
        data: {
          leadId: booking.leadId,
          businessId: user.businessId,
          type: "booking",
          description: status === "completed" ? `Attended their ${typeName}` : `Didn't attend their ${typeName}`,
          metadata: JSON.stringify({ bookingId: booking.id, startsAt: booking.startsAt.toISOString() }),
          actorId: user.userId,
          actorName: user.name,
        },
      });
    }
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "leads",
      description: `Marked ${booking.name}'s ${typeName} as ${status === "completed" ? "completed" : "a no-show"}`,
    });
    return { booking: { ...updated, cancelToken: undefined } };
  });
}
