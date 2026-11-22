import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { blockedOriginFor, publicPreflight, readPageContext, withPublicCors } from "@/lib/public-cors";
import { readPreChatForm } from "@/lib/widget-rules";
import { startWidgetSession } from "@/lib/widget-session";

// POST /api/public/session: the widget's pre-chat form starts the chat
// session before the first message, with the visitor's details, so the
// contact exists even if they leave without writing. The widget then sends
// the same details to /api/public/lead with this session id.

const schema = z.object({
  pk: z.string().min(1).max(191),
  visitorId: z.string().max(191).nullable().optional(),
  attribution: z.unknown().optional(),
  page: z.unknown().optional(),
  ruleId: z.string().max(191).nullable().optional(),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(191).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
});

export const OPTIONS = publicPreflight;

export const POST = withPublicCors(async (req: NextRequest) => {
  const ip = getClientIp(req);
  const rl = await rateLimit(`prechat:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error = field === "email" ? "Please enter a valid email address." : field === "name" ? "Please enter your name." : "Please check your details.";
    return NextResponse.json({ error, field }, { status: 400 });
  }
  const d = parsed.data;

  const business = await db.business.findUnique({
    where: { publicKey: d.pk, status: "active" },
    select: { id: true, widgetAllowedOrigins: true },
  });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const blocked = await blockedOriginFor(req, business);
  if (blocked) return blocked;

  const agent = await db.aiAgent.findFirst({ where: { businessId: business.id, status: "active" }, select: { id: true, preChatForm: true } });
  if (!agent) return NextResponse.json({ error: "No active AI agent for this business" }, { status: 503 });

  // Enforce the tenant's required fields server-side too.
  const form = readPreChatForm(agent.preChatForm);
  if (form) {
    for (const key of ["email", "phone", "company"] as const) {
      if (form.fields[key] === "required" && !d[key]) {
        return NextResponse.json({ error: `Please enter your ${key === "phone" ? "phone number" : key}.`, field: key }, { status: 400 });
      }
    }
  }

  const started = await startWidgetSession({
    businessId: business.id,
    agentId: agent.id,
    visitorId: d.visitorId,
    attribution: d.attribution,
    profile: { name: d.name, email: d.email || null, phone: d.phone || null },
    page: readPageContext(d.page),
    ruleId: d.ruleId,
  });
  if ("error" in started) return NextResponse.json({ error: started.error }, { status: started.status });
  return NextResponse.json({ sessionId: started.session.id });
});
