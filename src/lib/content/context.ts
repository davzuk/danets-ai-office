import { db } from "@/lib/db";
import { retrieveKnowledge } from "@/lib/ai";
import { getBrandContext, getBrandProfileRow, toInput } from "@/lib/brand";
import type { ContentContext } from "./generate";

/** Brand voice, banned phrases and the KB articles most relevant to the brief. */
export async function loadContentContext(businessId: string, brief: string): Promise<ContentContext> {
  const [business, brandContext, row, kb] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    getBrandContext(businessId),
    getBrandProfileRow(businessId),
    retrieveKnowledge(businessId, brief, 4),
  ]);
  return {
    businessName: business?.name ?? "",
    brandContext,
    dontPhrases: toInput(row)?.dontPhrases ?? [],
    facts: kb.map((k) => ({ title: k.title, content: k.content })),
  };
}
