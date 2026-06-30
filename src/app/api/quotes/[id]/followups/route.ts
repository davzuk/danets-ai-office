import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const followupSchema = z.object({
  type: z.enum(["email", "whatsapp", "call", "note"]),
  content: z.string().min(1).max(5000),
  scheduledFor: z.string().datetime().optional().nullable(),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/quotes/[id]/followups — list follow-ups
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const followups = await db.proposalFollowup.findMany({
      where: { quoteRequestId: id },
      orderBy: { createdAt: "desc" },
    });

    return {
      followups: followups.map((f) => ({
        id: f.id,
        type: f.type,
        content: f.content,
        scheduledFor: f.scheduledFor?.toISOString() || null,
        completedAt: f.completedAt?.toISOString() || null,
        createdByName: f.createdByName,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  });
}

// POST /api/quotes/[id]/followups — add a follow-up
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = followupSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const f = await db.proposalFollowup.create({
      data: {
        quoteRequestId: id,
        businessId: user.businessId,
        type: parsed.data.type,
        content: parsed.data.content.trim(),
        scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
        createdBy: user.userId,
        createdByName: user.name,
      },
    });

    return { followup: f };
  });
}
