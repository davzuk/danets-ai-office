import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/app-error";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { blockedOriginFor, publicPreflight, withPublicCors } from "@/lib/public-cors";
import { submitForm } from "@/lib/forms/service";
import { loadPublicForm } from "@/lib/forms/public";

export const OPTIONS = publicPreflight;

type Ctx = { params: Promise<{ id: string }> };

/** Spam answers are kept for review, but only as plain short strings. */
function heldAnswers(raw: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 50)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 4000);
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

// GET /api/public/forms/<id>: the form as the embed and hosted page render it.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withPublicCors(async (inner: NextRequest) => {
    const loaded = await loadPublicForm(id);
    if (!loaded) return NextResponse.json({ error: "Form not found." }, { status: 404 });
    const blocked = await blockedOriginFor(inner, loaded.business);
    if (blocked) return blocked;
    return NextResponse.json({ form: loaded.public }, { headers: { "Cache-Control": "public, max-age=60" } });
  })(req);
}

// POST /api/public/forms/<id>: a visitor submits a form. Screened for spam
// (honeypot field, minimum fill time, per-form rate limit) before a lead is
// created; suspected spam is stored with no lead.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withPublicCors(async (inner: NextRequest) => {
    const ip = getClientIp(inner);
    const rl = await rateLimit(`form:${id}:${ip}`, 5, 10 * 60 * 1000);
    if (!rl.success) return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
    // Across all visitors, so one form can't be used to flood a tenant's leads.
    const perForm = await rateLimit(`form-all:${id}`, 300, 60 * 60 * 1000);
    if (!perForm.success) return NextResponse.json({ error: "This form is busy. Try again later." }, { status: 429 });

    const body = (await inner.json().catch(() => null)) as {
      answers?: unknown;
      pageUrl?: unknown;
      startedAt?: unknown;
      website?: unknown;
      attribution?: unknown;
      visitorId?: unknown;
      consent?: unknown;
    } | null;

    const loaded = await loadPublicForm(id);
    if (!loaded) return NextResponse.json({ error: "Form not found." }, { status: 404 });
    const blocked = await blockedOriginFor(inner, loaded.business);
    if (blocked) return blocked;
    const { form } = loaded;

    const honeypot = typeof body?.website === "string" && body.website.trim() !== "";
    const startedAt = typeof body?.startedAt === "number" ? body.startedAt : null;
    const tooFast = startedAt != null && Date.now() - startedAt < 3000;
    const ipHash = createHash("sha256").update(`${ip}:${process.env.IP_HASH_SALT || "danets"}`).digest("hex").slice(0, 64);

    if (honeypot || tooFast) {
      await db.formSubmission.create({
        data: {
          businessId: form.businessId,
          formId: form.id,
          data: heldAnswers(body?.answers) as unknown as Prisma.InputJsonValue,
          pageUrl: typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null,
          ipHash,
          spamScore: honeypot && tooFast ? 10 : 5,
          status: "spam",
        },
      });
      // Looks like success to the bot.
      return NextResponse.json({ accepted: true });
    }

    try {
      await submitForm(form, {
        answers: body?.answers ?? {},
        pageUrl: typeof body?.pageUrl === "string" ? body.pageUrl : null,
        ipHash,
        attribution: body?.attribution,
        visitorId: typeof body?.visitorId === "string" ? body.visitorId.slice(0, 64) : null,
        consent: body?.consent === true,
      });
      // Lead ids stay private: the visitor's browser doesn't need them.
      return NextResponse.json({ accepted: true });
    } catch (e) {
      if (isAppError(e)) return NextResponse.json(e.toResponseBody(), { status: e.status });
      throw e;
    }
  })(req);
}
