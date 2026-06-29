"use client";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  iconClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  iconClassName,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6",
        className
      )}
    >
      <div
        className={cn(
          "relative mb-4",
        )}
      >
        {/* Decorative gradient ring */}
        <div className="absolute inset-0 rounded-full bg-primary/5 blur-xl scale-150" />
        <div
          className={cn(
            "relative h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center",
            iconClassName
          )}
        >
          <Icon size={24} className="text-primary" />
        </div>
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
