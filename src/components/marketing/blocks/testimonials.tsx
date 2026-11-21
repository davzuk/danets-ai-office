import { Star, Quote } from "lucide-react";

type Testimonial = {
  quote: string;
  author: string;
  role?: string;
  company?: string;
  avatarUrl?: string;
};

type TestimonialsProps = {
  eyebrow?: string;
  title?: string;
  testimonials?: Testimonial[];
};

export function TestimonialsBlock({
  eyebrow = "Testimonials",
  title = "Loved by customer-facing teams",
  testimonials = [],
}: TestimonialsProps) {
  if (testimonials.length === 0) return null;

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {eyebrow}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {title}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <figure
              key={i}
              className="rounded-xl border bg-card p-6 flex flex-col"
            >
              <Quote className="h-6 w-6 text-primary/40 mb-3" />
              <blockquote className="text-sm leading-relaxed flex-1">
                {t.quote}
              </blockquote>
              <div className="mt-5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full brand-gradient text-white flex items-center justify-center font-semibold text-sm">
                  {t.author?.charAt(0).toUpperCase() || "•"}
                </div>
                <div className="text-xs">
                  <div className="font-semibold">{t.author}</div>
                  {(t.role || t.company) && (
                    <div className="text-muted-foreground">
                      {[t.role, t.company].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Star
                    key={idx}
                    size={12}
                    className="fill-yellow-400 text-yellow-400"
                  />
                ))}
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
