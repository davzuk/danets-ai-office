import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { updateCampaignSchema } from "@/lib/campaigns/rules";
import { deleteCampaign, getCampaign, updateCampaign } from "@/lib/campaigns/service";

type Ctx = { params: Promise<{ id: string }> };
const actor = (u: { businessId: string; userId: string; name: string; role: string }) => ({ businessId: u.businessId, userId: u.userId, name: u.name, role: u.role });

// GET /api/campaigns/:id: the campaign, its linked items and touch breakdowns.
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    return { ...(await getCampaign(user.businessId, id)), canDelete: user.role === "admin" };
  });
}

// PATCH /api/campaigns/:id: edit details or change status.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = updateCampaignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { campaign: await updateCampaign(actor(user), id, parsed.data) };
  });
}

// DELETE /api/campaigns/:id (admin): linked items and touches are kept, unlinked.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    return deleteCampaign(actor(user), id);
  });
}
