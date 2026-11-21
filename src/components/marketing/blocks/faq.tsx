"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type FaqItem = { question: string; answer: string };

type FaqProps = {
  eyebrow?: string;
  title?: string;
  items?: FaqItem[];
};

export function FaqBlock({
  eyebrow = "FAQ",
  title = "Frequently asked questions",
  items = [],
}: FaqProps) {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
            {eyebrow}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {title}
          </h2>
        </div>
        <div className="rounded-xl border bg-card divide-y">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No FAQ items yet.
            </div>
          ) : (
            items.map((item, i) => <FaqRow key={i} item={item} />)
          )}
        </div>
      </div>
    </section>
  );
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="font-medium text-sm">{item.question}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
          {item.answer}
        </div>
      ) : null}
    </div>
  );
}
