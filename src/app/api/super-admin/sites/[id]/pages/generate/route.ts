import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";
import { generatePage, LANDING_GOALS, newSpend, type PageRefs } from "@/lib/sites/ai";
import { createGeneratedPage } from "@/lib/sites/service";
import { builderContext, loadSite, pageView, recordAiSpend, withPlatformAdmin } from "@/lib/sites/platform";

const schema = z.object({
  prompt: z.string().trim().min(10, "Describe the page in a sentence or two.").max(4000),
  goal: z.enum(LANDING_GOALS),
  audience: z.string().trim().max(300).optional(),
  offer: z.string().trim().max(300).optional(),
  formId: z.string().max(40).optional(),
  magnetId: z.string().max(40).optional(),
  bookingTypeSlug: z.string().max(80).optional(),
});

// POST /api/super-admin/sites/<id>/pages/generate: build a landing page with
// AI from one prompt and save it as a draft.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformAdmin(async (admin) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid input", { status: 400, code: "INVALID_INPUT" });
    const input = parsed.data;
    const { site, actor } = await loadSite((await params).id, admin);
    const businessId = site.businessId;

    // The conversion target must be the tenant's own.
    const refs: PageRefs = {};
    if (input.goal === "leads") {
      const form = input.formId ? await db.leadFormDef.findFirst({ where: { id: input.formId, businessId, status: "active" }, select: { id: true, name: true } }) : null;
      if (!form) throw new AppError("Choose one of the business's active forms for the page to capture leads with.", { status: 400, code: "NO_FORM" });
      refs.formId = form.id;
      refs.formName = form.name;
    } else if (input.goal === "downloads") {
      const magnet = input.magnetId ? await db.leadMagnet.findFirst({ where: { id: input.magnetId, businessId }, select: { id: true, title: true } }) : null;
      if (!magnet) throw new AppError("Choose one of the business's lead magnets to offer.", { status: 400, code: "NO_MAGNET" });
      refs.magnetId = magnet.id;
      refs.magnetTitle = magnet.title;
    } else if (input.bookingTypeSlug) {
      const type = await db.bookingType.findFirst({ where: { businessId, slug: input.bookingTypeSlug, active: true }, select: { slug: true, name: true } });
      if (!type) throw new AppError("That booking type isn't available.", { status: 400, code: "NO_BOOKING_TYPE" });
      refs.bookingTypeSlug = type.slug;
      refs.bookingTypeName = type.name;
    }

    const ctx = await builderContext(businessId, [input.prompt, input.offer].filter(Boolean).join("\n"));
    const spend = newSpend();
    let built;
    try {
      built = await generatePage(ctx, input, refs, spend);
    } finally {
      await recordAiSpend(actor, "Generated a landing page with AI (platform)", spend, { siteId: site.id, goal: input.goal });
    }
    const brief = [input.prompt, `Goal: ${input.goal}`, input.audience && `Audience: ${input.audience}`, input.offer && `Offer: ${input.offer}`].filter(Boolean).join("\n");
    const page = await createGeneratedPage(actor, { ...built, prompt: brief });
    return { page: pageView(page), aiCalls: spend.calls };
  });
}
