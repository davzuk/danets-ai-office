import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { listMarketingPlans } from "@/lib/cms";

type PricingTableProps = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
};

/**
 * Renders the active SubscriptionPlan rows as a pricing grid. Because
 * the CMS stores the page blocks but pricing data lives in the
 * canonical SubscriptionPlan table, the table is always in sync with
 * what the checkout actually bills.
 */
export async function PricingTableBlock({
  eyebrow = "Pricing",
  title = "Plans that grow with your business",
  subtitle = "Start free. Upgrade when you need more chat capacity, automations or seats.",
  ctaLabel = "Start free",
  ctaHref = "/signup",
}: PricingTableProps) {
  // Never let a pricing-data fetch failure 500 the whole marketing
  // page — fall back to a static card so the site keeps rendering.
  let plans: Awaited<ReturnType<typeof listMarketingPlans>> = [];
  try {
    plans = await listMarketingPlans();
  } catch (err) {
    console.error("[pricing-table] Failed to load plans:", err);
    return (
      <section className="py-16 sm:py-24 bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {eyebrow}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Pricing details are temporarily unavailable. Please refresh in a
            moment or{" "}
            <Link href="/contact" className="text-primary hover:underline">
              contact sales
            </Link>{" "}
            for a quote.
          </p>
        </div>
      </section>
    );
  }

  if (plans.length === 0) return null;

  return (
    <section className="py-16 sm:py-24 bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {eyebrow}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {title}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan, i) => {
            const featured = plan.name === "pro";
            return (
              <div
                key={plan.name}
                className={`rounded-2xl border p-6 flex flex-col ${
                  featured
                    ? "bg-card shadow-xl ring-2 ring-primary"
                    : "bg-card"
                }`}
              >
                {featured ? (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-2">
                    Most popular
                  </div>
                ) : null}
                <div className="text-lg font-bold capitalize">{plan.name}</div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold">
                    ${plan.priceUsd}
                  </span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {plan.chatLimit.toLocaleString()} chats ·{" "}
                  {plan.leadLimit.toLocaleString()} leads / mo
                </p>

                <ul className="mt-6 space-y-2.5 text-sm flex-1">
                  {plan.features.slice(0, 6).map((f, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link href={ctaHref} className="mt-6">
                  <Button
                    className="w-full"
                    variant={featured ? "default" : "outline"}
                  >
                    {ctaLabel}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Need more? Enterprise plans include SSO, custom integrations and
          dedicated support.{" "}
          <Link href="/contact" className="text-primary hover:underline">
            Talk to sales
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
