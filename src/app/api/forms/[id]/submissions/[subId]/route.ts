import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { deleteSubmission, releaseSubmission } from "@/lib/forms/service";
import { sendMagnetEmail } from "@/lib/magnets/service";

type Ctx = { params: Promise<{ id: string; subId: string }> };

// POST /api/forms/<id>/submissions/<subId>: release a submission held as spam.
export async function POST(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { subId } = await params;
    const result = await releaseSubmission({ businessId: user.businessId, userId: user.userId, name: user.name }, subId);
    // A held lead-magnet request gets its download link once released.
    let magnetEmailed = false;
    if (result.leadMagnetId && result.email) {
      const magnet = await db.leadMagnet.findFirst({ where: { id: result.leadMagnetId, businessId: user.businessId, status: "published" } });
      if (magnet?.fileKey) magnetEmailed = await sendMagnetEmail(magnet, { id: result.submissionId, leadId: result.leadId }, result.email, result.name);
    }
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "form_spam_released", module: "leads", description: "Released a form submission held as spam", metadata: { submissionId: subId, leadId: result.leadId } });
    return { submissionId: result.submissionId, leadId: result.leadId, alreadyExists: result.alreadyExists, magnetEmailed };
  });
}

// DELETE /api/forms/<id>/submissions/<subId>
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { subId } = await params;
    await deleteSubmission(user.businessId, subId);
    return { success: true };
  });
}
