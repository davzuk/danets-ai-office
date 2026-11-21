import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { parseBody } from "@/lib/content/posts";
import { markPosted, markPostedSchema } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/scheduled-posts/:id/mark-posted { permalink? }: posted by hand
export function POST(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const input = await parseBody(req, markPostedSchema);
    return { schedule: await markPosted(user, id, input.permalink) };
  });
}
