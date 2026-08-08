import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCmsAdmin } from "@/lib/cms/server";

export async function GET(req: NextRequest) {
  const auth = await requireCmsAdmin();
  if (!auth.ok) return auth.error;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, Number(searchParams.get("limit") ?? 100));
  const contacts = await db.cmsContactSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ contacts });
}
