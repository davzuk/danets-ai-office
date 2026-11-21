import type { Metadata } from "next";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data deletion status — Danets AI Automation", robots: { index: false } };

/** Public status page Meta links users to after a data-deletion request. */
export default async function DataDeletionStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const request = /^[a-f0-9]{24}$/.test(code)
    ? await db.metaDataDeletionRequest.findUnique({ where: { code }, select: { status: true, createdAt: true, completedAt: true } })
    : null;

  return (
    <section className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Data deletion request</h1>
      {request ? (
        <div className="mt-6 space-y-2 text-muted-foreground">
          <p>
            Confirmation code: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{code}</code>
          </p>
          <p>
            Status: <strong className="text-foreground">{request.status === "completed" ? "Completed" : "In progress"}</strong>
          </p>
          <p>Received {request.createdAt.toUTCString()}.</p>
          {request.completedAt && <p>Completed {request.completedAt.toUTCString()}.</p>}
          <p className="pt-4">
            We deleted the Facebook and Instagram connection data and page access tokens linked to your Facebook
            account. Businesses that use Danets keep the leads and messages their own customers sent them.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-muted-foreground">We couldn&apos;t find a deletion request with that confirmation code.</p>
      )}
    </section>
  );
}
