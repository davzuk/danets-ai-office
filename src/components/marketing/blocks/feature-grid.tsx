import {
  Bot,
  BookOpen,
  MessagesSquare,
  Users,
  FileText,
  BarChart3,
  Zap,
  Plug,
  ShieldCheck,
  Sparkles,
  MessageCircle,
  CreditCard,
  History,
  Settings,
  Code2,
  Ticket,
  LayoutDashboard,
} from "lucide-react";

// Mapping of lucide icon name → component for editor-configured blocks.
// Keeping this explicit avoids `dynamic()` imports which would break ISR.
const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Bot, BookOpen, MessagesSquare, Users, FileText, BarChart3, Zap, Plug,
  ShieldCheck, Sparkles, MessageCircle, CreditCard, History, Settings,
  Code2, Ticket, LayoutDashboard,
};

type FeatureItem = {
  icon?: string; // lucide name
  title: string;
  description?: string;
};

type FeatureGridProps = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  columns?: 2 | 3 | 4;
  features?: FeatureItem[];
};

export function FeatureGridBlock({
  eyebrow,
  title,
  subtitle,
  columns = 3,
  features = [],
}: FeatureGridProps) {
  const colCls =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {(title || subtitle || eyebrow) && (
          <div className="max-w-2xl mx-auto text-center mb-12">
            {eyebrow ? (
              <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        )}

        <div className={`grid grid-cols-1 ${colCls} gap-6`}>
          {features.map((f, i) => {
            const Icon = (f.icon && ICONS[f.icon]) || Sparkles;
            return (
              <div
                key={i}
                className="rounded-xl border bg-card p-6 card-hover"
              >
                <div className="h-10 w-10 rounded-lg brand-gradient flex items-center justify-center text-white mb-4">
                  <Icon size={20} />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{f.title}</h3>
                {f.description ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.description}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
