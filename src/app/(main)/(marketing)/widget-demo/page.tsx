import { WidgetDemoClient } from "@/components/marketing/widget-demo-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Widget Demo — Danets AI Automation",
  description:
    "See how the Danets AI chat widget appears on your website. Click the bubble to start a conversation.",
};

export default function WidgetDemoPage() {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <WidgetDemoClient />
      </div>
    </section>
  );
}