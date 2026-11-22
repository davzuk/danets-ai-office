import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { MAX_ALLOWED_ORIGINS, normalizeOriginList, readAllowedOrigins } from "@/lib/public-cors";

// GET/PUT /api/business/widget-origins: the websites allowed to run this
// tenant's chat widget. An empty list means any website.

export async function GET() {
  return withSession(async (user) => {
    const b = await db.business.findUnique({ where: { id: user.businessId }, select: { widgetAllowedOrigins: true } });
    return { origins: readAllowedOrigins(b?.widgetAllowedOrigins), max: MAX_ALLOWED_ORIGINS, canEdit: user.role === "admin" };
  });
}

const schema = z.object({ origins: z.array(z.string().max(253)).max(MAX_ALLOWED_ORIGINS * 2) });

export async function PUT(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("Send a list of website addresses.", { status: 400, code: "INVALID_INPUT" });

    const { origins, invalid } = normalizeOriginList(parsed.data.origins);
    if (invalid.length > 0) {
      throw new AppError(`Not a website address: ${invalid.slice(0, 3).join(", ")}`, {
        status: 400,
        code: "INVALID_ORIGIN",
        details: { invalid },
      });
    }

    const before = await db.business.findUnique({ where: { id: user.businessId }, select: { widgetAllowedOrigins: true } });
    await db.business.update({
      where: { id: user.businessId },
      data: { widgetAllowedOrigins: origins }, // [] = any website
    });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "update",
      module: "embed",
      description: origins.length > 0 ? `Locked the chat widget to ${origins.length} website${origins.length === 1 ? "" : "s"}` : "Allowed the chat widget on any website",
      metadata: { before: readAllowedOrigins(before?.widgetAllowedOrigins), after: origins },
    });
    return { origins };
  });
}
