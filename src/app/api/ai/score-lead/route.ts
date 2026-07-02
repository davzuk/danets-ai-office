import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { scoreLead } from "@/lib/ai-scoring";

const schema = z.object({ leadId: z.string().min(1) });

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const score = await scoreLead(parsed.data.leadId, user.businessId);
  return NextResponse.json({ leadId: parsed.data.leadId, score });
}
