import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/conversations/[id]
// Returns a single ChatSession with all messages (asc by createdAt) + lead.
// The session MUST belong to the user's business.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;

    const session = await db.chatSession.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        lead: true,
        agent: {
          select: { id: true, botName: true },
        },
      },
    });

    if (!session || session.businessId !== user.businessId) {
      // Not found or belongs to another tenant — return null (apiHandler wraps as 200)
      return { session: null };
    }

    return { session };
  });
}
