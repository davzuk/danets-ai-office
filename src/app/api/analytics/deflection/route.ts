import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { analyzeDeflection } from "@/lib/ai-scoring";

export async function GET(_req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const result = await analyzeDeflection(user.businessId);
  return NextResponse.json(result);
}
