import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { logActivity } from "@/lib/activity";
import { requireAiQuota } from "@/lib/plan-limits";
import { LimitExceededError, formatLimitExceededMessage, requireQuota } from "@/lib/plan-quota";
import { loadContentContext } from "@/lib/content/context";
import { generateMagnet } from "@/lib/magnets/generate";
import { MAGNET_STYLES, type MagnetStyle } from "@/lib/magnets/content";
import { createMagnet, toMagnetDto } from "@/lib/magnets/service";

export const runtime = "nodejs";

// POST /api/lead-magnets/generate: { prompt, style: "checklist" | "guide", formId? }
// The AI writes a lead magnet (1 AI credit); it is saved as a draft.
export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const body = ((await req.json().catch(() => null)) ?? {}) as { prompt?: unknown; style?: unknown; formId?: unknown };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length < 10) throw new AppError("Describe the lead magnet in a sentence or two.", { status: 400, code: "INVALID_INPUT" });
    if (prompt.length > 1500) throw new AppError("Keep the description under 1,500 characters.", { status: 400, code: "INVALID_INPUT" });
    const style: MagnetStyle = MAGNET_STYLES.includes(body.style as MagnetStyle) ? (body.style as MagnetStyle) : "checklist";
    // Check the magnet quota before spending an AI credit.
    try {
      await requireQuota(user.businessId, "leadMagnets");
    } catch (e) {
      if (e instanceof LimitExceededError) throw new AppError(formatLimitExceededMessage(e), { status: 429, code: "LIMIT_EXCEEDED" });
      throw e;
    }
    await requireAiQuota(user.businessId);
    const ctx = await loadContentContext(user.businessId, prompt);
    const g = await generateMagnet(user.businessId, ctx, prompt, style);
    const m = await createMagnet(user.businessId, {
      title: g.title,
      kind: "ai",
      description: g.description,
      bullets: g.bullets,
      content: g.content,
      style,
      formId: body.formId,
    });
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "lead_magnet_created", module: "leads", description: `Generated the lead magnet "${m.title}" with AI`, metadata: { leadMagnetId: m.id } });
    return { magnet: toMagnetDto(m) };
  });
}
