import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { listSubmissions } from "@/lib/forms/service";

// GET /api/forms/<id>/submissions?status=accepted|spam|all
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const s = req.nextUrl.searchParams.get("status");
    const status = s === "accepted" || s === "spam" ? s : "all";
    return { submissions: await listSubmissions(user.businessId, id, status) };
  });
}
