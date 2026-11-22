import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { blockedOrigin, publicPreflight, withPublicCors } from "@/lib/public-cors";

// POST /api/public/widget/event: the widget reports that it showed a
// proactive message. Counted at most once per visitor per rule every 30
// minutes, so reloads and scripted calls can't inflate the numbers much.
// Chats and leads are counted server-side when they happen.

const schema = z.object({
  pk: z.string().min(1).max(191),
  ruleId: z.string().min(1).max(191),
  visitorId: z.string().min(1).max(191),
  event: z.literal("show"),
});

export const OPTIONS = publicPreflight;

export const POST = withPublicCors(async (req: NextRequest) => {
  const ip = getClientIp(req);
  const rl = await rateLimit(`wevent:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.success) return NextResponse.json({ ok: false }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { pk, ruleId, visitorId } = parsed.data;

  const business = await db.business.findUnique({ where: { publicKey: pk, status: "active" }, select: { id: true, widgetAllowedOrigins: true } });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const blocked = blockedOrigin(req, business.widgetAllowedOrigins);
  if (blocked) return blocked;

  const once = await rateLimit(`wevent:${ruleId}:${visitorId}`, 1, 30 * 60 * 1000);
  if (!once.success) return NextResponse.json({ ok: true, counted: false });

  const res = await db.widgetRule.updateMany({ where: { id: ruleId, businessId: business.id, enabled: true }, data: { shows: { increment: 1 } } });
  return NextResponse.json({ ok: true, counted: res.count > 0 });
});
