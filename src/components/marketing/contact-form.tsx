"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";

export function ContactForm() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      company: String(formData.get("company") ?? "").trim() || undefined,
      message: String(formData.get("message") ?? "").trim(),
    };
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setSubmitted(true);
      toast.success("Thanks! We'll be in touch within one business day.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <Send className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-bold">Message received</h2>
        <p className="text-sm text-muted-foreground">
          Someone from our team will reply shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border bg-card p-6 sm:p-8 space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="name" className="text-xs font-medium">
          Full name
        </Label>
        <Input id="name" name="name" required placeholder="Jane Doe" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-xs font-medium">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@company.com"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="phone" className="text-xs font-medium">
            Phone <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input id="phone" name="phone" placeholder="+234 ..." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company" className="text-xs font-medium">
            Company <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input id="company" name="company" placeholder="Acme Inc." />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message" className="text-xs font-medium">
          How can we help?
        </Label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Tell us a bit about your business and what you're looking for."
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Send className="h-4 w-4 mr-2" />
        )}
        Send message
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        By submitting you agree to be contacted about your enquiry.
      </p>
    </form>
  );
}