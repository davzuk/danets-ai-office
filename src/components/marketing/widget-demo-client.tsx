"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

/**
 * Public widget demo. Lets a visitor paste their publicKey (from the
 * dashboard → Embed view) and load the chat widget inside a fake
 * website so they can see what the visitor experience looks like.
 *
 * This is the React equivalent of the old /widget-demo plain HTML route.
 */
export function WidgetDemoClient() {
  const [pk, setPk] = useState("");
  const [active, setActive] = useState(false);

  function activate(e: React.FormEvent) {
    e.preventDefault();
    setActive(true);
  }

  return (
    <div className="space-y-8">
      <header className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          Live demo
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          See the AI chat widget in action
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Paste your widget public key (from your dashboard) below and we'll
          embed the chat bubble so you can talk to your AI agent.
        </p>
      </header>

      {!active ? (
        <form
          onSubmit={activate}
          className="rounded-xl border bg-card p-6 space-y-4 max-w-md mx-auto"
        >
          <div className="space-y-1.5">
            <Label htmlFor="pk" className="text-xs font-medium">
              Widget public key
            </Label>
            <Input
              id="pk"
              value={pk}
              onChange={(e) => setPk(e.target.value)}
              placeholder="ckxxxxxx..."
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={!pk.trim()}>
            Load widget
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            No public key yet?{" "}
            <a href="/signup" className="text-primary hover:underline">
              Create a free account
            </a>{" "}
            to get one.
          </p>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden border bg-card">
            <iframe
              src={`/widget-demo?pk=${encodeURIComponent(pk)}`}
              className="w-full h-[640px]"
              title="Widget demo"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Public key <code className="font-mono">{pk}</code> · This page
            is for testing only.
          </p>
        </div>
      )}
    </div>
  );
}