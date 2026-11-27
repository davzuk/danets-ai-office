import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { approveReply } from "@/lib/seo/reviews";

const schema = z.object({ text: z.string().trim().min(2).max(4000).optional() }).nullable();

// POST /api/seo/reviews/:id/approve {text?}: an admin approves a waiting
// reply (optionally edited) and it posts to Google.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    return approveReply({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id, parsed.data?.text);
  });
}
