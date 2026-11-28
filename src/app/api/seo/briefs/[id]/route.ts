import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/lib/api";
import { db } from "@/lib/db";
import { briefFileName, deleteBrief, getBrief, publicBrief } from "@/lib/seo/briefs";
import { renderBriefPdf } from "@/lib/seo/brief-pdf";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

// GET: the brief as JSON; ?format=md or ?format=pdf downloads it.
export async function GET(req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    const b = await getBrief(user.businessId, id);
    const format = new URL(req.url).searchParams.get("format");
    const headers = (type: string, name: string, size: number) => ({
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    });
    if (format === "md") {
      const body = Buffer.from(b.markdown, "utf8");
      return new NextResponse(body, { headers: headers("text/markdown; charset=utf-8", briefFileName(b.query, "md"), body.byteLength) });
    }
    if (format === "pdf") {
      const business = await db.business.findUnique({ where: { id: user.businessId }, select: { name: true } });
      const body = await renderBriefPdf({ query: b.query, businessName: business?.name ?? "", brief: publicBrief(b).brief });
      return new NextResponse(new Uint8Array(body), { headers: headers("application/pdf", briefFileName(b.query, "pdf"), body.byteLength) });
    }
    return { brief: publicBrief(b) };
  });
}

// DELETE: remove a brief (its writer, or an admin).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withSession(async (user) => {
    const { id } = await params;
    await deleteBrief({ businessId: user.businessId, userId: user.userId, name: user.name, role: user.role }, id);
    return { ok: true };
  });
}
