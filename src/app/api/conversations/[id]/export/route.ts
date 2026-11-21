import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/conversations/[id]/export
// Returns a plain-text transcript of the conversation as a downloadable .txt file.
// The session MUST belong to the user's business (multi-tenant guard).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const session = await db.chatSession.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
      lead: true,
      business: { select: { name: true } },
    },
  });

  if (!session) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  // ── Build the transcript ────────────────────────────────────────────
  const businessName = session.business?.name || user.businessName;
  const visitorName =
    session.visitorName?.trim() ||
    session.visitorEmail?.trim() ||
    (session.visitorId ? `Visitor ${session.visitorId.slice(-4)}` : "Anonymous visitor");

  const visitorContact: string[] = [];
  if (session.visitorName?.trim()) visitorContact.push(session.visitorName.trim());
  if (session.visitorEmail?.trim()) visitorContact.push(session.visitorEmail.trim());
  if (session.visitorPhone?.trim()) visitorContact.push(session.visitorPhone.trim());
  const visitorLine =
    visitorContact.length > 0 ? visitorContact.join(" · ") : visitorName;

  const lines: string[] = [];
  const SEP = "─────────────────────────────────────";

  lines.push("Danets AI Automation - Conversation Transcript");
  lines.push(`Business: ${businessName}`);
  lines.push(`Visitor: ${visitorLine}`);
  lines.push(`Date: ${session.createdAt.toISOString()}`);
  lines.push(`Status: ${session.status}`);
  lines.push(SEP);
  lines.push("");

  if (session.messages.length === 0) {
    lines.push("(No messages in this conversation)");
    lines.push("");
  } else {
    for (const m of session.messages) {
      const time = m.createdAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const label = roleLabel(m.role);
      lines.push(`[${time}] ${label}: ${m.content}`);
    }
    lines.push("");
  }

  lines.push(SEP);

  // Lead / summary footer
  const footer: string[] = [];
  if (session.lead) {
    const leadBits: string[] = [session.lead.name];
    if (session.lead.quality) leadBits.push(`Quality: ${session.lead.quality}`);
    if (session.lead.status) leadBits.push(`Status: ${session.lead.status}`);
    footer.push(`Lead: ${leadBits.join(" | ")}`);
  } else {
    footer.push("Lead: (none captured)");
  }
  if (session.summary) footer.push(`Summary: ${session.summary}`);
  if (session.nextAction) footer.push(`Next Action: ${session.nextAction}`);

  lines.push(...footer);

  const transcript = lines.join("\n");

  // ── Sanitize filename ──────────────────────────────────────────────
  const safeName = visitorName
    .replace(/[^\w\d-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "conversation";
  const filename = `conversation-${safeName}.txt`;

  return new NextResponse(transcript, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Map a ChatMessage role to a human-readable label for the transcript. */
function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "Visitor";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}
