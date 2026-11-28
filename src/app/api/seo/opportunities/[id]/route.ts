import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { setDismissed } from "@/lib/seo/keywords";

// PATCH {dismissed: boolean}: hide an opportunity, or bring it back (admin).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { dismissed?: unknown } | null;
    if (typeof body?.dismissed !== "boolean") throw new AppError("Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { opportunity: await setDismissed({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id, body.dismissed) };
  });
}
