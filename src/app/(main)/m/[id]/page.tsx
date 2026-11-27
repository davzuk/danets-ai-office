import { notFound } from "next/navigation";
import { CheckCircle2, FileText } from "lucide-react";
import { loadPublicMagnet } from "@/lib/magnets/service";
import { LeadFormRenderer } from "@/components/forms/lead-form-renderer";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const loaded = await loadPublicMagnet(id);
  return { title: loaded ? `${loaded.public.title} · ${loaded.public.form.businessName}` : "Download" };
}

// /m/<magnetId>: a lead magnet's download page. The visitor fills in the
// gate form and gets the PDF by email.
export default async function HostedMagnetPage({ params, searchParams }: Props) {
  const { id } = await params;
  const loaded = await loadPublicMagnet(id);
  if (!loaded) notFound();
  const m = loaded.public;
  const accent = m.form.brandColor || "#1d4ed8";

  const q = await searchParams;
  const hiddenValues: Record<string, string> = {};
  for (const f of m.form.fields) {
    const v = q[f.key];
    if (f.type === "hidden" && typeof v === "string") hiddenValues[f.key] = v.slice(0, 500);
  }

  return (
    <div className="rounded-2xl border bg-background p-6 shadow-sm sm:p-8">
      <div className="mb-6 space-y-3">
        <div className="text-sm text-muted-foreground">{m.form.businessName}</div>
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${accent}1a`, color: accent }}>
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{m.title}</h1>
        </div>
        {m.description && <p className="text-muted-foreground">{m.description}</p>}
        {m.bullets.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {m.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <LeadFormRenderer
        form={m.form}
        hiddenValues={hiddenValues}
        magnetId={m.id}
        doneMessage="Thanks! Check your inbox: we've emailed you the download link."
      />
    </div>
  );
}
