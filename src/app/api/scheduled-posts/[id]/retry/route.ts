import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { retrySchedule } from "@/lib/content/schedule";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/scheduled-posts/:id/retry: publish a failed post again, now
export function POST(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    return { schedule: await retrySchedule(user, id) };
  });
}
