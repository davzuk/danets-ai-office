import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

export async function GET() {
  return withSession(async (user) => {
    const where = { businessId: user.businessId };

    const [total, active, draft, archived, byCategoryRows, bySourceRows] =
      await Promise.all([
        db.knowledgeBaseItem.count({ where }),
        db.knowledgeBaseItem.count({ where: { ...where, status: "active" } }),
        db.knowledgeBaseItem.count({ where: { ...where, status: "draft" } }),
        db.knowledgeBaseItem.count({ where: { ...where, status: "archived" } }),
        db.knowledgeBaseItem.groupBy({
          by: ["category"],
          _count: { _all: true },
          where,
          orderBy: { category: "asc" },
        }),
        db.knowledgeBaseItem.groupBy({
          by: ["sourceType"],
          _count: { _all: true },
          where,
          orderBy: { sourceType: "asc" },
        }),
      ]);

    return {
      total,
      active,
      draft,
      archived,
      byCategory: byCategoryRows.map((r) => ({
        category: r.category,
        count: r._count._all,
      })),
      bySource: bySourceRows.map((r) => ({
        sourceType: r.sourceType,
        count: r._count._all,
      })),
    };
  });
}
