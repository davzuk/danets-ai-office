import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { db } from "@/lib/db";
import { AppError } from "@/lib/app-error";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    const form = await db.leadFormDef.findFirst({ where: { id, businessId: user.businessId }, select: { id: true } });
    if (!form) throw new AppError("Form not found.", { status: 404, code: "NOT_FOUND" });
    const submissions = await db.formSubmission.findMany({
      where: { formId: id },
      select: { id: true, leadId: true, contactId: true, data: true, pageUrl: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { submissions };
  });
}