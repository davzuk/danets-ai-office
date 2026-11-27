import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { deleteSubmission, releaseSubmission } from "@/lib/forms/service";

type Ctx = { params: Promise<{ id: string; subId: string }> };

// POST /api/forms/<id>/submissions/<subId>: release a submission held as spam.
export async function POST(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { subId } = await params;
    const result = await releaseSubmission({ businessId: user.businessId, userId: user.userId, name: user.name }, subId);
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "form_spam_released", module: "leads", description: "Released a form submission held as spam", metadata: { submissionId: subId, leadId: result.leadId } });
    return result;
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
