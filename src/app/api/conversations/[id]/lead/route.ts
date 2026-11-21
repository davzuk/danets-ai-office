import { NextRequest } from "next/server";
import { z } from "zod";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { createLeadFromThread } from "@/lib/social/inbox-reply";

type RouteCtx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().max(191).optional(),
  email: z.string().trim().email().max(191).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

// POST /api/conversations/[id]/lead: create (or enrich) the lead for a social thread
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid request", { status: 400, code: "INVALID_REQUEST" });
    const { lead, created } = await createLeadFromThread(
      id,
      user.businessId,
      { name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null },
      { userId: user.userId, name: user.name }
    );
    return { lead, created };
  });
}
