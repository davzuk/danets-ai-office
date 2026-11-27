import { NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/app-error";
import { newSpend, rewriteSection, SECTION_ACTIONS } from "@/lib/sites/ai";
import { readBlocks } from "@/lib/sites/blocks";
import { getPageOrThrow } from "@/lib/sites/service";
import { builderContext, loadSite, recordAiSpend, withPlatformAdmin } from "@/lib/sites/platform";

const blockSchema = z.object({ id: z.string().min(1).max(40), blockKey: z.string().min(1).max(40), props: z.record(z.string(), z.unknown()) });

const schema = z.object({
  action: z.enum(SECTION_ACTIONS),
  instruction: z.string().trim().max(500).optional(),
  // The block as it is in the editor now (it may have unsaved edits).
  block: blockSchema,
  // The page's blocks, for the outline.
  blocks: z.array(blockSchema).max(60),
});

const blockTitle = (props: Record<string, unknown>) => (typeof props.title === "string" ? props.title.slice(0, 80) : "");

// POST /api/super-admin/sites/<id>/pages/<pageId>/rewrite: rewrite one
// section with AI. Returns the new block; the editor decides whether to keep it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  return withPlatformAdmin(async (admin) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Invalid input", { status: 400, code: "INVALID_INPUT" });
    if (parsed.data.action === "custom" && !parsed.data.instruction) throw new AppError("Say what to change.", { status: 400, code: "INVALID_INPUT" });
    const { id, pageId } = await params;
    const { site, actor } = await loadSite(id, admin);
    const page = await getPageOrThrow(site.businessId, pageId);
    if (page.siteId !== site.id) throw new AppError("Page not found.", { status: 404, code: "NOT_FOUND" });

    const [block] = readBlocks([parsed.data.block]);
    if (!block) throw new AppError("Unknown block", { status: 400, code: "INVALID_INPUT" });
    const outline = readBlocks(parsed.data.blocks).map((b) => ({ blockKey: b.blockKey, title: blockTitle(b.props) }));
    const ctx = await builderContext(site.businessId, [page.title, blockTitle(block.props), parsed.data.instruction].filter(Boolean).join("\n"));
    const spend = newSpend();
    try {
      const next = await rewriteSection(ctx, block, outline, parsed.data.action, parsed.data.instruction ?? null, spend);
      return { block: next };
    } finally {
      await recordAiSpend(actor, `Rewrote a ${block.blockKey} section of "${page.title}" with AI (platform)`, spend, { pageId: page.id, action: parsed.data.action });
    }
  });
}
