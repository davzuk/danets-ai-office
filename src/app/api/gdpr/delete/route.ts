import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, destroySession } from "@/lib/auth";

const deleteSchema = z.object({ confirm: z.literal("DELETE ALL MY DATA") });

export async function POST(req: NextRequest) {
  let user;
  try { user = await requireSession(); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Confirmation required. Send { "confirm": "DELETE ALL MY DATA" }.' }, { status: 400 });

  await db.business.delete({ where: { id: user.businessId } });
  await destroySession();
  return NextResponse.json({ success: true, message: "All business data has been permanently deleted." });
}
