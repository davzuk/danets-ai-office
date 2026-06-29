import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/quotes/[id] — single quote request + all its generated documents.
// Always verifies businessId ownership.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return withSession(async (user) => {
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!quote) throw new Error("FORBIDDEN");

    return {
      quote: {
        id: quote.id,
        clientName: quote.clientName,
        companyName: quote.companyName,
        service: quote.service,
        requirements: quote.requirements,
        budgetRange: quote.budgetRange,
        timeline: quote.timeline,
        notes: quote.notes,
        status: quote.status,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        documents: quote.documents.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          type: d.type,
          createdAt: d.createdAt,
        })),
      },
    };
  });
}

// DELETE /api/quotes/[id] — delete quote request (verifies businessId ownership).
// Associated GeneratedDocuments are removed first; otherwise Prisma's SetNull
// would orphan them with a null quoteRequestId.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return withSession(async (user) => {
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    await db.generatedDocument.deleteMany({
      where: { quoteRequestId: id },
    });
    await db.quoteRequest.delete({ where: { id } });

    return { ok: true, id };
  });
}
