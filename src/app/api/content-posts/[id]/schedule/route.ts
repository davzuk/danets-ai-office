import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { parseBody } from "@/lib/content/posts";
import { scheduleSchema, schedulePost } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/content-posts/:id/schedule { scheduledFor?, publishNow?, targets: [{ platform, socialAccountId | null }] }
// No account = a reminder to post by hand at that time.
export function POST(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const input = await parseBody(req, scheduleSchema);
    return schedulePost(user, id, input);
  });
}
