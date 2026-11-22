"use client";

// A Calendly scheduling page embedded on the hosted booking page, with the
// visitor's details and the link's UTM tags passed through. Calendly sends
// its own confirmation; with a Calendly connection (Pro) the booking also
// reaches Danets by webhook.

import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { calendlyEmbedUrl } from "@/lib/booking/calendly";

const noopSubscribe = () => () => {};

export function CalendlyEmbed({ url, title, prefill }: { url: string; title: string; prefill?: { name?: string; email?: string } }) {
  // Built in the browser: it needs this page's host and query string.
  const src = useSyncExternalStore(
    noopSubscribe,
    () => {
      const q = new URLSearchParams(window.location.search);
      return calendlyEmbedUrl(url, {
        embedDomain: window.location.host,
        name: prefill?.name,
        email: prefill?.email,
        utm: { source: q.get("utm_source"), medium: q.get("utm_medium"), campaign: q.get("utm_campaign"), term: q.get("utm_term"), content: q.get("utm_content") },
      });
    },
    () => null
  );
  if (!src) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading scheduler" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <iframe src={src} title={`Schedule: ${title}`} className="w-full rounded-lg border-0" style={{ minHeight: 700 }} />
      <p className="text-xs text-muted-foreground">
        Scheduling by Calendly.{" "}
        <a className="underline" href={src} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
      </p>
    </div>
  );
}
