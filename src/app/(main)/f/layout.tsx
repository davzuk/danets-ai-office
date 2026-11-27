import type { Metadata } from "next";

// Hosted lead forms (Phase 2, workstream S) live on the app's domain (or a
// tenant's white-label domain), so they're kept out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function HostedFormLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="min-h-screen bg-muted/40 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}
