import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { discardDraft, replySchema, submitReply } from "@/lib/seo/reviews";

// POST /api/seo/reviews/:id/reply {text}: post the reply to Google, or send
// it for approval when the content approval policy says so.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = replySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return submitReply({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id, parsed.data.text);
  });
}

// DELETE /api/seo/reviews/:id/reply: throw away the draft or waiting reply
// (a reply already on Google stays).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    return discardDraft({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id);
  });
}
