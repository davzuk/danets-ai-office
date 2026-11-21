type Stat = { label: string; value: string; sublabel?: string };

type StatsProps = {
  title?: string;
  stats?: Stat[];
  variant?: "default" | "muted";
};

export function StatsBlock({
  title,
  stats = [],
  variant = "default",
}: StatsProps) {
  return (
    <section
      className={`py-12 sm:py-16 ${variant === "muted" ? "bg-muted/30" : ""}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {title ? (
          <h2 className="text-center text-xl sm:text-2xl font-bold tracking-tight mb-10">
            {title}
          </h2>
        ) : null}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {stats.map((s, i) => (
            <div key={i}>
              <div className="text-3xl sm:text-4xl font-extrabold brand-text">
                {s.value}
              </div>
              <div className="text-sm font-medium mt-1">{s.label}</div>
              {s.sublabel ? (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {s.sublabel}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
