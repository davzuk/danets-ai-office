import type { Metadata } from "next";
import Link from "next/link";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Documentation — Danets AI Automation",
  description:
    "Guides, references and recipes for getting the most out of Danets AI Automation.",
};

const SECTIONS = [
  {
    title: "Getting started",
    items: [
      { title: "Quick start", href: "/docs" },
      { title: "Embed the widget on your site", href: "/docs" },
      { title: "Connect your knowledge base", href: "/docs" },
    ],
  },
  {
    title: "Chat & leads",
    items: [
      { title: "Configuring your AI agent", href: "/docs" },
      { title: "Lead capture forms", href: "/docs" },
      { title: "Handover to a human", href: "/docs" },
    ],
  },
  {
    title: "Quotes & documents",
    items: [
      { title: "Generating proposals with AI", href: "/docs" },
      { title: "Document Q&A", href: "/docs" },
    ],
  },
  {
    title: "Operations",
    items: [
      { title: "WhatsApp templates", href: "/docs" },
      { title: "Automation workflows", href: "/docs" },
      { title: "Integrations", href: "/docs" },
    ],
  },
];

export default function DocsPage() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <header className="mb-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
            Documentation
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Everything you need to launch
          </h1>
          <p className="text-lg text-muted-foreground mt-2 max-w-2xl">
            Public guides for the platform. In-depth, tenant-specific
            documentation lives inside the product dashboard.
          </p>
        </header>

        <div className="grid sm:grid-cols-2 gap-6">
          {SECTIONS.map((section) => (
            <div
              key={section.title}
              className="rounded-xl border bg-card p-6"
            >
              <h2 className="font-semibold mb-3">{section.title}</h2>
              <ul className="space-y-2 text-sm">
                {section.items.map((it) => (
                  <li key={it.title}>
                    <Link
                      href={it.href}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {it.title} →
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-xl border bg-muted/30 p-6 text-sm">
          <p className="text-muted-foreground">
            Looking for the full docs site? The in-app help center has
            tenant-specific guides, API references and recipes.{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in →
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}