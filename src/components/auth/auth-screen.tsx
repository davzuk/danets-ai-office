"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Sparkles, Lock, Mail, User, Building2, Shield, KeyRound } from "lucide-react";
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
  isSuperAdmin?: boolean;
  isPlatformAdmin?: boolean;
  totpEnabled?: boolean;
}

type AuthMode = "login" | "register" | "platform";

export function AuthScreen({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const router = useRouter();

  const [form, setForm] = useState({
    email: "admin@danetstecpro.com",
    password: "danets123",
    name: "",
    businessName: "",
    industry: "",
    totpCode: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "platform") {
        const res = await fetch("/api/platform-auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            totpCode: form.totpCode || undefined,
          }),
        });
        const data = await res.json();
        if (data.requiresTotp) {
          setNeedsTotp(true);
          setForm((f) => ({ ...f, email: data.email || f.email }));
          toast.message("Enter your 2FA code to continue");
          return;
        }
        if (!res.ok) throw new Error(data.error || "Authentication failed");
        toast.success("Platform admin access granted");
        onAuthed(data.user);
        router.refresh();
        return;
      }

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "platform"
      ? "Platform admin sign in"
      : mode === "login"
        ? "Sign in to your dashboard"
        : "Create your business account";

  const subtitle =
    mode === "platform"
      ? "Danets TecPro internal operators — separate secure auth realm."
      : mode === "login"
        ? "Enter your credentials to access Danets AI Automation."
        : "Start automating your customer conversations in minutes.";

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
            <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {mode === "platform" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <Shield className="h-4 w-4 shrink-0" />
              Internal platform access only. All actions are audit-logged.
            </div>
          )}

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
              placeholder={mode === "platform" ? "superadmin@danetstecpro.com" : "you@company.com"}
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
            {(mode === "platform" && needsTotp) && (
              <Field
                icon={<KeyRound size={16} />}
                label="2FA code"
                value={form.totpCode}
                onChange={(v) => setForm({ ...form, totpCode: v })}
                placeholder="6-digit code"
                required
              />
            )}

            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "platform"
                ? needsTotp
                  ? "Verify & sign in"
                  : "Platform sign in"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            {mode === "platform" ? (
              <>
                Tenant dashboard?{" "}
                <button
                  className="text-primary font-semibold hover:underline"
                  onClick={() => {
                    setMode("login");
                    setNeedsTotp(false);
                    setForm((f) => ({ ...f, totpCode: "" }));
                  }}
                >
                  Business sign in
                </button>
              </>
            ) : mode === "login" ? (
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
            <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground text-center space-y-2">
              <div>
                <span className="font-medium text-foreground">Demo account:</span>{" "}
                admin@danetstecpro.com · danets123
              </div>
              <button
                type="button"
                className="text-primary font-semibold hover:underline inline-flex items-center gap-1"
                onClick={() => {
                  setMode("platform");
                  setForm({
                    email: "superadmin@danetstecpro.com",
                    password: "super123",
                    name: "",
                    businessName: "",
                    industry: "",
                    totpCode: "",
                  });
                  setNeedsTotp(false);
                }}
              >
                <Shield size={12} />
                Platform admin sign in
              </button>
            </div>
          )}

          {mode === "platform" && !needsTotp && (
            <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground text-center">
              <span className="font-medium text-foreground">Platform demo:</span>{" "}
              superadmin@danetstecpro.com · super123
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
