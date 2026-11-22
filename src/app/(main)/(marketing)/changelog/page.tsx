import type { Metadata } from "next";
import { listCmsChangelog } from "@/lib/cms";
import { Badge } from "@/components/ui/badge";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Changelog — Danets AI Automation",
  description:
    "What's new in Danets AI Automation — releases, improvements and fixes.",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const KIND_STYLES: Record<string, string> = {
  release: "bg-primary/10 text-primary",
  improvement: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  fix: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  security: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

export default async function ChangelogPage() {
  const entries = await listCmsChangelog(50);
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="mb-10">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            Changelog
          </div>
          <h1 className="text-4xl font-bold tracking-tight">What's new</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Releases, improvements and fixes shipped to Danets AI Automation.
          </p>
        </header>

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No changelog entries yet.
          </p>
        ) : (
          <ol className="space-y-8">
            {entries.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border bg-card p-6 card-hover"
              >
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    v{e.version}
                  </span>
                  <Badge
                    variant="secondary"
                    className={KIND_STYLES[e.kind] ?? KIND_STYLES.release}
                  >
                    {e.kind}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDate(e.publishedAt)}
                  </span>
                </div>
                <h2 className="text-xl font-semibold">{e.title}</h2>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
                  {e.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
