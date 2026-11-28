import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { removeKeyword, updateKeyword, updateKeywordSchema } from "@/lib/seo/keywords";

type Ctx = { params: Promise<{ id: string }> };
const actor = (u: { businessId: string; userId: string; name: string; role: string }) => ({ businessId: u.businessId, userId: u.userId, name: u.name, role: u.role });

// PATCH {targetUrl}: the page meant to rank for this keyword (admin).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = updateKeywordSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return { keyword: await updateKeyword(actor(user), id, parsed.data) };
  });
}

// DELETE: stop tracking it (admin).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    await removeKeyword(actor(user), id);
    return { ok: true };
  });
}
