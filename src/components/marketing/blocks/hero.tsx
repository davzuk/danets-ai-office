import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

type HeroProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  highlight?: string;
};

export function HeroBlock({
  eyebrow,
  title,
  subtitle,
  primaryCtaLabel = "Get started",
  primaryCtaHref = "/signup",
  secondaryCtaLabel,
  secondaryCtaHref,
  highlight,
}: HeroProps) {
  // Allow {highlight} inline tokens in `title` to be rendered as a brand
  // gradient — common marketing-site pattern.
  const parts = highlight
    ? title.split(highlight)
    : null;

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 dark:opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, oklch(0.7 0.16 255 / 0.25), transparent 35%), radial-gradient(circle at 80% 30%, oklch(0.85 0.18 122 / 0.18), transparent 40%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-32">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          {eyebrow ? (
            <div className="inline-flex items-center rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
            {parts ? (
              <>
                {parts[0]}
                <span className="brand-text">{highlight}</span>
                {parts.slice(1).join(highlight)}
              </>
            ) : (
              title
            )}
          </h1>

          {subtitle ? (
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {subtitle}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href={primaryCtaHref}>
              <Button size="lg" className="h-12 px-6 text-base gap-2">
                {primaryCtaLabel}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            {secondaryCtaLabel && secondaryCtaHref ? (
              <Link href={secondaryCtaHref}>
                <Button size="lg" variant="outline" className="h-12 px-6 text-base">
                  {secondaryCtaLabel}
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
