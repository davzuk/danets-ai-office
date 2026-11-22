import type { Metadata } from "next";

// Hosted booking pages live on the app's domain until tenant sites (Q)
// exist, so they're kept out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="min-h-screen bg-muted/40 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-4xl">{children}</div>
      <p className="mt-8 text-center text-xs text-muted-foreground">Scheduling by Danets AI</p>
    </main>
  );
}
