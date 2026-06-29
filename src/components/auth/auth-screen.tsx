"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Sparkles, Lock, Mail, User, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DanetsLogo } from "@/components/dashboard/shared/danets-logo";

interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
}

export function AuthScreen({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [form, setForm] = useState({
    email: "admin@danetstecpro.com",
    password: "danets123",
    name: "",
    businessName: "",
    industry: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : {
              name: form.name,
              email: form.email,
              password: form.password,
              businessName: form.businessName,
              industry: form.industry,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      toast.success(mode === "login" ? "Welcome back!" : "Account created!");
      onAuthed(data.user);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 brand-gradient text-white overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        <div className="relative">
          <DanetsLogo size="lg" variant="full" />
        </div>
        <div className="relative space-y-6 max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            Automate your customer chat, leads & proposals with AI.
          </h1>
          <p className="text-white/85 text-lg">
            Danets AI Automation helps businesses deploy an intelligent website
            chatbot, capture leads 24/7, and generate quotes — all from one
            secure dashboard.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-4">
            {[
              { icon: Sparkles, label: "AI chat widget" },
              { icon: ShieldCheck, label: "Secure multi-tenant" },
              { icon: User, label: "Lead capture" },
              { icon: Building2, label: "Quote generator" },
            ].map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur px-3 py-2.5 text-sm font-medium"
              >
                <f.icon size={16} />
                {f.label}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-sm text-white/70">
          © {new Date().getFullYear()} Danets TecPro Limited — Software, Cloud,
          AI Automation & Cybersecurity.
        </div>
      </div>

      {/* Right auth form */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center lg:hidden">
            <div className="flex justify-center">
              <DanetsLogo size="lg" />
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">
              {mode === "login" ? "Sign in to your dashboard" : "Create your business account"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "login"
                ? "Enter your credentials to access Danets AI Automation."
                : "Start automating your customer conversations in minutes."}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <>
                <Field
                  icon={<Building2 size={16} />}
                  label="Business name"
                  value={form.businessName}
                  onChange={(v) => setForm({ ...form, businessName: v })}
                  placeholder="Acme Inc."
                  required
                />
                <Field
                  icon={<User size={16} />}
                  label="Your name"
                  value={form.name}
                  onChange={(v) => setForm({ ...form, name: v })}
                  placeholder="John Doe"
                  required
                />
                <Field
                  icon={<Building2 size={16} />}
                  label="Industry (optional)"
                  value={form.industry}
                  onChange={(v) => setForm({ ...form, industry: v })}
                  placeholder="e.g. Retail, SaaS, Healthcare"
                />
              </>
            )}
            <Field
              icon={<Mail size={16} />}
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="you@company.com"
              required
            />
            <Field
              icon={<Lock size={16} />}
              label="Password"
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              placeholder="••••••••"
              required
            />

            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  className="text-primary font-semibold hover:underline"
                  onClick={() => setMode("register")}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  className="text-primary font-semibold hover:underline"
                  onClick={() => setMode("login")}
                >
                  Sign in
                </button>
              </>
            )}
          </div>

          {mode === "login" && (
            <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground text-center">
              <span className="font-medium text-foreground">Demo account:</span>{" "}
              admin@danetstecpro.com · danets123
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="h-11 pl-9"
        />
      </div>
    </div>
  );
}
