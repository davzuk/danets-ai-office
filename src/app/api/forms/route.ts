import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { createForm, listForms } from "@/lib/forms/service";

// /api/forms: the tenant's lead-capture forms.
export async function GET() {
  return withSession(async (user) => {
    const forms = await listForms(user.businessId);
    return { forms };
  });
}

export async function POST(req: NextRequest) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const body = (await req.json().catch(() => null)) as { name?: unknown; fields?: unknown; settings?: unknown } | null;
    const form = await createForm(
      { businessId: user.businessId, userId: user.userId, name: user.name },
      { name: body?.name, fields: body?.fields, settings: body?.settings }
    );
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "form_created", module: "leads", description: `Created the form "${form.name}"`, metadata: { formId: form.id } });
    return { form };
  });
}