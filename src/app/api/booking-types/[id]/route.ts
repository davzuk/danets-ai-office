import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { bookingTypeInputSchema } from "@/lib/booking/slots";

type Ctx = { params: Promise<{ id: string }> };

// A full edit, or just { active } from the list switch.
const patchSchema = z.union([bookingTypeInputSchema, z.object({ active: z.boolean() }).strict()]);

async function ownType(businessId: string, id: string) {
  const type = await db.bookingType.findFirst({ where: { id, businessId } });
  if (!type) throw new AppError("Booking type not found.", { status: 404, code: "NOT_FOUND" });
  return type;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const before = await ownType(user.businessId, id);
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || "Invalid booking type", { status: 400, code: "INVALID_INPUT" });
    }
    const data = parsed.data;
    if ("slug" in data && data.slug !== before.slug) {
      const taken = await db.bookingType.findUnique({ where: { businessId_slug: { businessId: user.businessId, slug: data.slug } }, select: { id: true } });
      if (taken) throw new AppError("Another booking type already uses that link.", { status: 409, code: "SLUG_TAKEN" });
    }
    if ("assignedUserId" in data && data.assignedUserId) {
      const member = await db.businessUser.findFirst({ where: { id: data.assignedUserId, businessId: user.businessId }, select: { id: true } });
      if (!member) throw new AppError("That team member isn't on your account.", { status: 400, code: "INVALID_INPUT" });
    }
    const type = await db.bookingType.update({ where: { id: before.id }, data });
    const onlyToggle = Object.keys(data).length === 1 && "active" in data;
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "leads",
      description: onlyToggle
        ? `${type.active ? "Opened" : "Closed"} booking type "${type.name}"`
        : `Updated booking type "${type.name}"`,
    });
    return { type };
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const type = await ownType(user.businessId, id);
    const upcoming = await db.booking.count({ where: { bookingTypeId: type.id, status: "confirmed", startsAt: { gt: new Date() } } });
    if (upcoming > 0) {
      throw new AppError(`This type has ${upcoming} upcoming booking${upcoming === 1 ? "" : "s"}. ${upcoming === 1 ? "Cancel it" : "Cancel them"} or turn the type off instead.`, {
        status: 409,
        code: "HAS_BOOKINGS",
      });
    }
    // Past bookings keep their details; only the link to the type is cleared.
    await db.bookingType.delete({ where: { id: type.id } });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "delete",
      module: "leads",
      description: `Deleted booking type "${type.name}"`,
    });
    return { ok: true };
  });
}
