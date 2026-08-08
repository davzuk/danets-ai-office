import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/conversations/[id]
// Returns a single ChatSession with all messages (asc by createdAt) + lead.
// The session MUST belong to the user's business. We use findFirst with
// { id, businessId } so the WHERE itself enforces tenant isolation — no
// chance of forgetting the post-load check after a future refactor.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withSession(async (user) => {
    const { id } = await params;

    const session = await db.chatSession.findFirst({
      where: { id, businessId: user.businessId },
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

    if (!session) {
      return { session: null };
    }

    return { session };
  });
}
