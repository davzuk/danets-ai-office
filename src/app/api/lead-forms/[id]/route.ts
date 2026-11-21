import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { leadFormPatchSchema, toPublicLeadForm } from "@/lib/social/lead-forms";

type RouteCtx = { params: Promise<{ id: string }> };

// PATCH /api/lead-forms/[id]: switch a form on/off or change its field mapping (admins only)
export function PATCH(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const parsed = leadFormPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    }
    const row = await db.metaLeadForm.findFirst({ where: { id, businessId: user.businessId } });
    if (!row) throw new AppError("Lead form not found", { status: 404, code: "NOT_FOUND" });

    const { enabled, fieldMapping } = parsed.data;
    const updated = await db.metaLeadForm.update({
      where: { id: row.id },
      data: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(fieldMapping ? { fieldMapping: fieldMapping as Prisma.InputJsonValue } : {}),
      },
      include: { socialAccount: { select: { name: true, platform: true } } },
    });
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "lead_form_updated",
      module: "leads",
      description: `Updated Meta lead form "${row.name}"`,
      metadata: { leadFormId: row.id, enabled, mappingChanged: !!fieldMapping },
    });
    return { form: toPublicLeadForm(updated) };
  });
}
