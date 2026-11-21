import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { parseBody } from "@/lib/content/posts";
import { cancelSchedule, reschedule, rescheduleSchema } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/scheduled-posts/:id { scheduledFor }: move it (calendar drag)
export function PATCH(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const input = await parseBody(req, rescheduleSchema);
    return { schedule: await reschedule(user, id, input.scheduledFor) };
  });
}

// DELETE /api/scheduled-posts/:id: cancel (the post itself stays)
export function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    return cancelSchedule(user, id);
  });
}
