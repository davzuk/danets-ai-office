"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Sparkles, Lock, Mail, User, Building2, KeyRound, AlertTriangle } from "lucide-react";
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
  totpEnabled?: boolean;
}

type AuthMode = "login" | "register";

/**
 * Demo credentials are gated to non-production builds so the live site never
 * pre-fills or advertises them in the rendered HTML.
 */
function isDemoMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEMO_MODE !== "false"
  );
}

export function AuthScreen({
  onAuthed,
  initialMode = "login",
  brand,
}: {
  onAuthed: (u: AuthUser) => void;
  initialMode?: AuthMode;
  brand?: { appName?: string; customLogoUrl?: string | null; hideBranding?: boolean; primaryColor?: string } | null;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [needsTotpSetup, setNeedsTotpSetup] = useState<{
    email: string;
    reason: "tenant_policy" | "user_opt_in";
  } | null>(null);
  const [platformStatus, setPlatformStatus] = useState<{
    platformName: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
    allowPublicSignup: boolean;
  } | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/platform/status")
      .then((r) => r.json())
      .then((data) => setPlatformStatus(data))
      .catch(() => null);
  }, []);

  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    businessName: "",
    industry: "",
    totpCode: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? {
              email: form.email,
              password: form.password,
              totpCode: form.totpCode || undefined,
            }
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
      if (data.requiresTotp) {
        setNeedsTotp(true);
        setForm((f) => ({ ...f, email: data.email || f.email }));
        toast.message("Enter your 2FA code to continue");
        return;
      }
      if (data.requiresTotpSetup) {
        setNeedsTotpSetup({
          email: data.email,
          reason: data.reason || "tenant_policy",
        });
        setForm((f) => ({ ...f, email: data.email || f.email }));
        toast.message(
          data.reason === "tenant_policy"
            ? "Your organization requires 2FA. Please set it up to continue."
            : "Please set up 2FA to continue."
        );
        return;
      }
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
    mode === "login"
      ? "Sign in to your dashboard"
      : "Create your business account";

  const subtitle =
    mode === "login"
      ? brand?.appName
        ? `Enter your credentials to access ${brand.appName}.`
        : "Enter your credentials to access Danets AI Automation."
      : "Start automating your customer conversations in minutes.";

  if (platformStatus?.maintenanceMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <div className="max-w-md w-full rounded-xl border bg-background p-8 text-center space-y-4 shadow-lg">
          <DanetsLogo size="lg" />
          <h1 className="text-xl font-semibold">Maintenance in progress</h1>
          <p className="text-sm text-muted-foreground">{platformStatus.maintenanceMessage}</p>
          <Link href="/platform" className="text-primary text-sm font-medium hover:underline">
            Platform admin console →
          </Link>
        </div>
      </div>
    );
  }

  const signupAllowed = platformStatus?.allowPublicSignup !== false;

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between p-12 brand-gradient text-white overflow-hidden" style={brand?.primaryColor ? { background: brand.primaryColor } : undefined}>
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        <div className="relative">
          <DanetsLogo size="lg" variant="full" brand={brand} />
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
        {!brand?.hideBranding && (
          <div className="relative text-sm text-white/70">
            © {new Date().getFullYear()} Danets TecPro Limited — Software, Cloud,
            AI Automation & Cybersecurity.
          </div>
        )}
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center lg:hidden">
            <div className="flex justify-center">
              <DanetsLogo size="lg" brand={brand} />
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {needsTotpSetup && (
              <div
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex items-start gap-3 text-amber-900 dark:text-amber-200"
              >
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <div className="space-y-1.5 text-sm">
                  <div className="font-semibold">
                    2FA setup required
                  </div>
                  <p>
                    {needsTotpSetup.reason === "tenant_policy"
                      ? "Your organization requires two-factor authentication for all members."
                      : "Two-factor authentication is required for this account."}
                    {" "}Please contact your administrator or sign in once 2FA
                    has been enabled on your account.
                  </p>
                </div>
              </div>
            )}
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
            {mode === "login" && (
              <div className="text-right -mt-2">
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            )}
            {mode === "login" && needsTotp && (
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
              disabled={loading || !!needsTotpSetup}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {needsTotpSetup
                ? "Sign in disabled — set up 2FA first"
                : mode === "login"
                ? needsTotp
                  ? "Verify & sign in"
                  : "Sign in"
                : "Create account"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              signupAllowed ? (
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
                <span>Public registration is currently disabled.</span>
              )
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

          {mode === "login" && isDemoMode() && (
            <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground text-center space-y-2">
              <div>
                <span className="font-medium text-foreground">Demo account:</span>{" "}
                admin@danetstecpro.com · danets123
              </div>
              <Link
                href="/platform"
                className="text-primary font-semibold hover:underline inline-flex items-center gap-1"
              >
                Platform admin console →
              </Link>
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
