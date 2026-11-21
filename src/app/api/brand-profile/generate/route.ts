import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { requireAiQuota } from "@/lib/plan-limits";
import { claimGeneration, getBrandProfileRow, toView } from "@/lib/brand";
import { enqueue } from "@/lib/jobs/queue";
import { brandGenerateJob } from "@/lib/jobs/handlers/brand-generate";

// POST /api/brand-profile/generate: queue an AI draft from the knowledge base (admins only).
export function POST(_req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const kbCount = await db.knowledgeBaseItem.count({ where: { businessId: user.businessId, status: "active" } });
    if (kbCount === 0) {
      throw new AppError("Add some knowledge base articles first: the brand voice is drafted from them.", {
        status: 400,
        code: "NO_KNOWLEDGE_BASE",
      });
    }
    await requireAiQuota(user.businessId);
    if (!(await claimGeneration(user.businessId))) {
      throw new AppError("A brand voice draft is already being generated.", { status: 409, code: "GENERATION_IN_PROGRESS" });
    }
    await enqueue(brandGenerateJob, { businessId: user.businessId }, { businessId: user.businessId });
    return { brand: toView(await getBrandProfileRow(user.businessId)) };
  });
}
