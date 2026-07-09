import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/super-admin";
import { sendTestEmail } from "@/lib/email";

const schema = z.object({
  to: z.string().email(),
});

// POST /api/super-admin/platform-config/test-email
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid email address required" }, { status: 400 });
  }

  const result = await sendTestEmail(parsed.data.to);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
