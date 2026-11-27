import { NextRequest } from "next/server";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { archiveForm, getForm, updateForm } from "@/lib/forms/service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    const { id } = await params;
    return { form: await getForm(user.businessId, id) };
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { name?: unknown; fields?: unknown; settings?: unknown; status?: unknown } | null;
    return { form: await updateForm(user.businessId, id, { name: body?.name, fields: body?.fields, settings: body?.settings, status: body?.status }) };
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async (user) => {
    if (user.role !== "admin" && user.role !== "owner") throw new Error("FORBIDDEN");
    const { id } = await params;
    const form = await archiveForm(user.businessId, id);
    logActivity({ businessId: user.businessId, userId: user.userId, userName: user.name, action: "form_archived", module: "leads", description: `Archived the form "${form.name}"`, metadata: { formId: form.id } });
    return { form };
  });
}