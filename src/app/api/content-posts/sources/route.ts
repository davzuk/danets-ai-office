import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const excerpt = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

// GET /api/content-posts/sources?q=: things worth repurposing into posts, with a ready-made brief
export function GET(req: NextRequest) {
  return withSession(async (user) => {
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const [articles, leads] = await Promise.all([
      db.knowledgeBaseItem.findMany({
        where: { businessId: user.businessId, status: "active", ...(q ? { title: { contains: q } } : {}) },
        orderBy: [{ views: "desc" }, { updatedAt: "desc" }],
        take: 30,
        select: { id: true, title: true, category: true, content: true },
      }),
      db.lead.findMany({
        where: { businessId: user.businessId, message: { not: null }, ...(q ? { message: { contains: q } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, service: true, message: true, createdAt: true },
      }),
    ]);
    return {
      sources: [
        ...articles.map((a) => ({
          type: "kb_article" as const,
          id: a.id,
          label: a.title,
          detail: a.category,
          brief: `Turn this knowledge base article into posts. Pick the single most useful takeaway for our audience.\n\nTitle: ${a.title}\n\n${excerpt(a.content, 3000)}`,
        })),
        ...leads
          .filter((l) => (l.message ?? "").trim().length >= 15)
          .map((l) => ({
            type: "lead_question" as const,
            id: l.id,
            label: excerpt(l.message ?? "", 90),
            detail: l.service || "Lead question",
            // Never the lead's name or contact details: the question only.
            brief: `A prospect asked us this. Answer it in a post that helps everyone with the same question (don't mention the person).\n\nQuestion: ${excerpt(l.message ?? "", 1500)}`,
          })),
      ],
    };
  });
}
