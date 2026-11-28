import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { assetLinkSchema } from "@/lib/campaigns/rules";
import { linkAsset } from "@/lib/campaigns/service";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/campaigns/:id/assets {type, id, linked}: add or remove a post,
// form, lead magnet or booking type. Pages are linked by the platform.
export async function POST(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = assetLinkSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { assets: await linkAsset({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id, parsed.data) };
  });
}
