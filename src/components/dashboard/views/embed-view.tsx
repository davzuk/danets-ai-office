"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Code2, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { WidgetOriginsCard } from "./widget-origins-card";

export function EmbedView({ user }: { user: any }) {
  const [pk, setPk] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/business")
      .then((r) => r.json())
      .then((d) => setPk(d.business?.publicKey || ""))
      .finally(() => setLoading(false));
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://ai.danetstecpro.com";
  const embedScript = `<script src="${origin}/widget.js?pk=${pk}" async></script>`;
  const cspLines = `script-src ${origin};\nconnect-src ${origin};`;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Widget Embed</h1>
        <p className="text-muted-foreground mt-1">
          Install the Danets AI chatbot on any website with a single line of code.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Install instructions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Code2 size={16} /> Quick install
              </CardTitle>
              <CardDescription>
                Paste this snippet before the closing <code className="text-xs bg-muted px-1 py-0.5 rounded">&lt;/body&gt;</code> tag on every page where you want the chatbot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative rounded-lg bg-zinc-950 text-zinc-50 p-4 text-sm font-mono overflow-x-auto">
                <pre className="whitespace-pre-wrap break-all">{embedScript}</pre>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 right-2 text-zinc-400 hover:text-white hover:bg-white/10"
                  onClick={() => copy(embedScript, "Embed code")}
                >
                  <Copy size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck size={14} className="text-accent-foreground" />
                Your public key (<code className="font-mono">{pk}</code>) is safe to expose — it only identifies your business publicly.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Embed options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-1.5">Script tag</div>
                <p className="text-xs text-muted-foreground mb-2">
                  Lightweight floating button that opens a chat window. Works on any site (HTML, WordPress, Shopify, Webflow, etc.).
                </p>
                <div className="relative rounded-lg bg-zinc-950 text-zinc-50 p-3 text-xs font-mono">
                  <pre className="whitespace-pre-wrap break-all">{embedScript}</pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-1.5 right-1.5 text-zinc-400 hover:text-white hover:bg-white/10 h-7 w-7"
                    onClick={() => copy(embedScript, "Script tag")}
                  >
                    <Copy size={12} />
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1.5">Waiting for cookie consent</div>
                <p className="text-xs text-muted-foreground mb-2">
                  If your site asks visitors for consent before tracking, add <code className="font-mono">data-consent=&quot;required&quot;</code> to the tag and call{" "}
                  <code className="font-mono">window.Danets.consent(true)</code> once they accept. The chat still works before that; only traffic-source tracking waits.
                </p>
              </div>

              <div>
                <div className="text-sm font-medium mb-1.5">If your site has a Content Security Policy</div>
                <p className="text-xs text-muted-foreground mb-2">
                  Most sites don&apos;t. If yours sends a <code className="font-mono">Content-Security-Policy</code> header, add this address to these two directives, or the widget is blocked:
                </p>
                <div className="relative rounded-lg bg-zinc-950 text-zinc-50 p-3 text-xs font-mono">
                  <pre className="whitespace-pre-wrap break-all">{cspLines}</pre>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Copy CSP lines"
                    className="absolute top-1.5 right-1.5 text-zinc-400 hover:text-white hover:bg-white/10 h-7 w-7"
                    onClick={() => copy(cspLines, "CSP lines")}
                  >
                    <Copy size={12} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <WidgetOriginsCard />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Setup checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5 text-sm">
                {[
                  "Configure your AI agent (name, tone, welcome message)",
                  "Add knowledge base articles so the bot can answer accurately",
                  "Set your contact details (WhatsApp, phone, email) for handover",
                  "Copy the embed script and paste it on your website",
                  "Test the chatbot as a visitor to verify answers",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Live preview</CardTitle>
                  <CardDescription>How your widget looks to visitors</CardDescription>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border bg-gradient-to-br from-muted/40 to-background p-6 min-h-[420px] relative overflow-hidden">
                <div className="text-center text-muted-foreground text-sm mb-4">
                  Your website content area
                </div>
                {/* Render the actual widget via script injection */}
                <WidgetPreview pk={pk} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test as a visitor</CardTitle>
              <CardDescription>
                Open the public widget in a full page to test the chat flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <a href={`/widget-demo?pk=${pk}`} target="_blank" rel="noopener">
                  <ExternalLink size={16} className="mr-2" /> Open test page
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function WidgetPreview({ pk }: { pk: string }) {
  useEffect(() => {
    if (!pk) return;
    // Clean up any previous widget instance
    const old = document.querySelector('script[data-danets-preview]');
    if (old) old.remove();
    const oldBtn = document.querySelector('.dn-btn');
    const oldWin = document.querySelector('.dn-win');
    if (oldBtn) oldBtn.remove();
    if (oldWin) oldWin.remove();
    delete (window as any).__danetsWidget;

    const s = document.createElement("script");
    s.src = `/widget.js?pk=${pk}`;
    s.async = true;
    s.setAttribute("data-danets-preview", "true");
    document.body.appendChild(s);
    return () => {
      // Don't remove on unmount in dev to avoid flicker; widget self-manages
    };
  }, [pk]);

  return (
    <div className="text-xs text-muted-foreground text-center mt-8">
      The floating chat button appears in the bottom-right corner →
    </div>
  );
}
