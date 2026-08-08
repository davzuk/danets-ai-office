import Link from "next/link";
import { Button } from "@/components/ui/button";

const FALLBACKS: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  home: {
    eyebrow: "DANETS",
    title: "AI chat, lead capture & proposals — on autopilot",
    subtitle:
      "Deploy an AI chatbot on your website, capture leads 24/7, generate quotes and automate customer support. Built by Danets TecPro Limited.",
  },
  pricing: {
    eyebrow: "PRICING",
    title: "Simple pricing that grows with you",
    subtitle:
      "Start free. Upgrade when you need more conversations, more agents or custom branding. No surprise fees.",
  },
  features: {
    eyebrow: "FEATURES",
    title: "Everything you need to automate growth",
    subtitle:
      "A single platform for chat, lead capture, quoting and workflow automation.",
  },
  about: {
    eyebrow: "ABOUT",
    title: "Built by Danets TecPro Limited",
    subtitle:
      "We build AI automation tools that help businesses convert more visitors, answer more questions, and ship more proposals.",
  },
  industries: {
    eyebrow: "INDUSTRIES",
    title: "Built for the way your industry sells",
    subtitle:
      "From SaaS to healthcare to professional services, Danets adapts to the conversations your customers actually have.",
  },
};

/**
 * Marketing page fallback — rendered when the corresponding CMS row is
 * missing. Renders a hero + CTA so the site keeps working until the page
 * is seeded.
 */
export function MarketingFallback({ slug }: { slug: string }) {
  const copy = FALLBACKS[slug] ?? FALLBACKS.home;

  return (
    <section className="py-24 sm:py-32 bg-gradient-to-b from-background to-muted/30">
      <div className="mx-auto max-w-4xl px-4 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
          {copy.eyebrow}
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          {copy.title}
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">{copy.subtitle}</p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="outline">
              Talk to sales
            </Button>
          </Link>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          This page is being prepared. The full content is temporarily unavailable.
        </p>
      </div>
    </section>
  );
}