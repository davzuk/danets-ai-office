import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/lib/api";
import { getReport, publicReport, renderReportPdfFor, reportFileName } from "@/lib/seo/report";

export const runtime = "nodejs";

// GET: the report as JSON; ?format=pdf downloads it (in the tenant's brand).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const row = await getReport(user.businessId, id);
    if (new URL(req.url).searchParams.get("format") === "pdf") {
      const body = await renderReportPdfFor(row);
      const r = publicReport(row);
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${reportFileName(r.data.businessName, row.month)}"`,
          "Content-Length": String(body.byteLength),
          "Cache-Control": "private, no-store",
        },
      });
    }
    return { report: publicReport(row) };
  });
}
