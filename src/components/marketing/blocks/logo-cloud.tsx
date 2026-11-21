type LogoCloudProps = {
  title?: string;
  logos?: { name: string; logoText?: string }[];
};

export function LogoCloudBlock({
  title = "Trusted by businesses across Nigeria and beyond",
  logos = [],
}: LogoCloudProps) {
  return (
    <section className="py-12 border-y bg-muted/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {title ? (
          <p className="text-center text-sm font-medium text-muted-foreground mb-8">
            {title}
          </p>
        ) : null}
        {logos.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground/70 italic">
            No logos configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 items-center">
            {logos.map((logo, i) => (
              <div
                key={i}
                className="flex items-center justify-center h-12 px-3 rounded-md border bg-background/50 text-muted-foreground font-semibold tracking-wider text-sm"
              >
                {logo.logoText || logo.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
