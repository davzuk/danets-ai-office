import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { AppError } from "@/lib/app-error";
import { emailReport, getReport, publicReport } from "@/lib/seo/report";

export const maxDuration = 60;

// POST: email the report PDF to the tenant's admins now (admin).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin") throw new Error("FORBIDDEN");
    const { id } = await params;
    const updated = await emailReport(await getReport(user.businessId, id));
    if (!updated.emailedAt || updated.emailError) throw new AppError(updated.emailError ?? "The report couldn't be emailed.", { status: 502, code: "EMAIL_FAILED" });
    return { report: publicReport(updated) };
  });
}
