import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/app-error";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { publicPreflight, withPublicCors } from "@/lib/public-cors";
import { submitForm } from "@/lib/forms/service";

export const OPTIONS = publicPreflight;

// POST /api/public/forms/<id>: a visitor submits a form. Screened for spam
// (honeypot field, minimum fill time, per-form rate limit) before a lead is
// created; suspected spam is stored with no lead.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPublicCors(async (inner: NextRequest) => {
    const ip = getClientIp(inner);
    const rl = await rateLimit(`form:${id}:${ip}`, 5, 10 * 60 * 1000);
    if (!rl.success) return NextResponse.json({ error: "Too many submissions." }, { status: 429 });

    const body = (await inner.json().catch(() => null)) as {
      answers?: unknown;
      pageUrl?: unknown;
      startedAt?: unknown;
      website?: unknown;
      attribution?: unknown;
      visitorId?: unknown;
    } | null;

    const form = await db.leadFormDef.findUnique({ where: { id } });
    if (!form || form.status !== "active") return NextResponse.json({ error: "Form not found." }, { status: 404 });
    const biz = await db.business.findUnique({ where: { id: form.businessId }, select: { status: true } });
    if (!biz || biz.status !== "active") return NextResponse.json({ error: "Form not found." }, { status: 404 });

    const honeypot = typeof body?.website === "string" && body.website.trim() !== "";
    const startedAt = typeof body?.startedAt === "number" ? body.startedAt : null;
    const tooFast = startedAt != null && Date.now() - startedAt < 3000;
    const ipHash = createHash("sha256").update(`${ip}:${process.env.IP_HASH_SALT || "danets"}`).digest("hex").slice(0, 64);

    if (honeypot || tooFast) {
      await db.formSubmission.create({
        data: {
          businessId: form.businessId,
          formId: form.id,
          data: (typeof body?.answers === "object" && body.answers ? body.answers : {}) as unknown as Prisma.InputJsonValue,
          pageUrl: typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null,
          ipHash,
          spamScore: honeypot && tooFast ? 10 : 5,
          status: "spam",
        },
      });
      return NextResponse.json({ accepted: false });
    }

    try {
      const result = await submitForm(form, {
        answers: body?.answers ?? {},
        pageUrl: typeof body?.pageUrl === "string" ? body.pageUrl : null,
        ipHash,
        attribution: body?.attribution,
        visitorId: typeof body?.visitorId === "string" ? body.visitorId : null,
      });
      return NextResponse.json({ accepted: true, ...result });
    } catch (e) {
      if (isAppError(e)) return NextResponse.json(e.toResponseBody(), { status: e.status });
      throw e;
    }
  })(req);
}