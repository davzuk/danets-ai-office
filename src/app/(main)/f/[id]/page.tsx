import { notFound } from "next/navigation";
import { loadPublicForm } from "@/lib/forms/public";
import { LeadFormRenderer } from "@/components/forms/lead-form-renderer";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const loaded = await loadPublicForm(id);
  return { title: loaded ? `${loaded.public.name} · ${loaded.public.businessName}` : "Form" };
}

// /f/<formId>: a tenant's lead form on its own page, for links in emails,
// social bios and ads.
export default async function HostedFormPage({ params, searchParams }: Props) {
  const { id } = await params;
  const loaded = await loadPublicForm(id);
  if (!loaded) notFound();
  const form = loaded.public;

  // Hidden fields take their value from the link (?campaign=spring).
  const q = await searchParams;
  const hiddenValues: Record<string, string> = {};
  for (const f of form.fields) {
    const v = q[f.key];
    if (f.type === "hidden" && typeof v === "string") hiddenValues[f.key] = v.slice(0, 500);
  }

  return (
    <div className="rounded-2xl border bg-background p-6 shadow-sm sm:p-8">
      <div className="mb-6">
        <div className="text-sm text-muted-foreground">{form.businessName}</div>
        <h1 className="text-2xl font-bold tracking-tight">{form.name}</h1>
      </div>
      <LeadFormRenderer form={form} hiddenValues={hiddenValues} />
    </div>
  );
}
