import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { blockedOrigin, publicPreflight, withPublicCors } from "@/lib/public-cors";
import { isModuleEnabled } from "@/lib/module-access";
import { readPreChatForm, toPublicRules } from "@/lib/widget-rules";
import { readQuestions } from "@/lib/booking/slots";

export const OPTIONS = publicPreflight;

export const GET = withPublicCors(async (req: NextRequest) => {
  const pk = req.nextUrl.searchParams.get("pk");
  if (!pk) {
    return NextResponse.json({ error: "Missing pk" }, { status: 400 });
  }

  const business = await db.business.findUnique({
    where: { publicKey: pk, status: "active" },
    select: { id: true, name: true, publicKey: true, plan: true, widgetAllowedOrigins: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const blocked = blockedOrigin(req, business.widgetAllowedOrigins);
  if (blocked) return blocked;

  const agent = await db.aiAgent.findFirst({
    where: { businessId: business.id, status: "active" },
    select: {
      botName: true,
      businessName: true,
      welcomeMessage: true,
      fallbackMessage: true,
      handoverMessage: true,
      tone: true,
      contactPhone: true,
      whatsappNumber: true,
      email: true,
      brandColor: true,
      quickReplies: true,
      leadCaptureEnabled: true,
      preChatForm: true,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "No active agent" }, { status: 503 });
  }

  // Proactive messages are a Starter+ feature; on lower plans the rules stay
  // saved but the widget gets none.
  const rules = (await isModuleEnabled(business.id, "proactive_messages", business.plan))
    ? toPublicRules(await db.widgetRule.findMany({ where: { businessId: business.id, enabled: true } }))
    : [];
  const { preChatForm, ...agentFields } = agent;

  // Booking (Leads module, Starter+): the widget's booking step needs the
  // active booking types; null hides it.
  const bookingTypes = (await isModuleEnabled(business.id, "leads", business.plan))
    ? await db.bookingType.findMany({
        where: { businessId: business.id, active: true, provider: "native" },
        orderBy: { createdAt: "asc" },
        select: { slug: true, name: true, durationMin: true, questions: true },
      })
    : [];
  // The widget asks only the required questions; optional ones stay on the booking page.
  const booking = bookingTypes.length
    ? {
        types: bookingTypes.map((t) => ({
          slug: t.slug,
          name: t.name,
          durationMin: t.durationMin,
          questions: readQuestions(t.questions)
            .filter((q) => q.required)
            .map((q) => ({ key: q.key, label: q.label })),
        })),
      }
    : null;

  // Cache for 1 minute in the end-user's browser only.
  //
  // `public` would let any shared proxy / corporate gateway cache the
  // bot config keyed by `pk` — and that key is the customer's identity
  // on the public widget. The audit flagged the previous `public,
  // max-age=300` as leaking customer bot configs to intermediary caches.
  // `private` keeps the response in the browser but tells intermediaries
  // not to store it. We also tag the response so the agent-edit handlers
  // can flush it via `revalidateTag()` on writes.
  return NextResponse.json(
    { publicKey: business.publicKey, businessName: business.name, agent: agentFields, preChatForm: readPreChatForm(preChatForm), rules, booking },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    }
  );
});
