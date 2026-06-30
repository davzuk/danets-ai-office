import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity, createNotification } from "@/lib/activity";
import { fireTrigger } from "@/lib/automation";

const acceptSchema = z.object({
  acceptedByName: z.string().min(2).max(100).optional(),
  acceptedByEmail: z.string().email().optional().or(z.literal("")),
  clientFeedback: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(["accepted", "rejected"]),
});

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/quotes/[id]/accept — record client acceptance or rejection
export async function POST(req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const quote = await db.quoteRequest.findFirst({
    where: { id, businessId: user.businessId },
    select: { id: true, clientName: true, companyName: true, service: true },
  });
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updated = await db.quoteRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      acceptedAt: parsed.data.status === "accepted" ? new Date() : null,
      acceptedByName: parsed.data.acceptedByName || null,
      acceptedByEmail: parsed.data.acceptedByEmail || null,
      clientFeedback: parsed.data.clientFeedback || null,
    },
  });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: user.name,
    action: "proposal_generated",
    module: "quotes",
    description: `Proposal for "${quote.clientName}" ${parsed.data.status}`,
    metadata: { quoteId: id, status: parsed.data.status },
  });

  if (parsed.data.status === "accepted") {
    await createNotification({
      businessId: user.businessId,
      type: "proposal_accepted",
      title: "Proposal accepted! 🎉",
      message: `${quote.clientName} accepted the proposal for ${quote.service}`,
      data: { quoteId: id },
    });

    // Fire automation trigger
    await fireTrigger("proposal_accepted", {
      businessId: user.businessId,
      proposalId: id,
      proposalClientName: quote.clientName,
    });
  }

  return NextResponse.json({ quote: updated });
}
