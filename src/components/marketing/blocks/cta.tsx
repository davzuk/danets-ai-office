import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

type CtaProps = {
  title?: string;
  subtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  variant?: "default" | "gradient";
};

export function CtaBlock({
  title = "Ready to automate your customer conversations?",
  subtitle = "Set up your free workspace in under five minutes. No credit card required.",
  primaryCtaLabel = "Start free",
  primaryCtaHref = "/signup",
  secondaryCtaLabel = "Talk to sales",
  secondaryCtaHref = "/contact",
  variant = "gradient",
}: CtaProps) {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          className={`rounded-2xl p-10 sm:p-16 text-center ${
            variant === "gradient"
              ? "brand-gradient text-white"
              : "border bg-card"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
            {title}
          </h2>
          <p
            className={`mt-4 text-lg max-w-2xl mx-auto ${
              variant === "gradient" ? "text-white/85" : "text-muted-foreground"
            }`}
          >
            {subtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={primaryCtaHref}>
              <Button
                size="lg"
                variant={variant === "gradient" ? "secondary" : "default"}
                className="h-12 px-6 text-base gap-2"
              >
                {primaryCtaLabel}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            {secondaryCtaLabel && secondaryCtaHref ? (
              <Link href={secondaryCtaHref}>
                <Button
                  size="lg"
                  variant="outline"
                  className={`h-12 px-6 text-base ${
                    variant === "gradient"
                      ? "bg-white/10 text-white border-white/30 hover:bg-white/20"
                      : ""
                  }`}
                >
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
