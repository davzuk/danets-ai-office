"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Shield, Lock, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DanetsLogo } from "@/components/dashboard/shared/danets-logo";

interface PlatformUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  businessId: string;
  businessName: string;
  isSuperAdmin: boolean;
  isPlatformAdmin?: boolean;
  totpEnabled?: boolean;
}

export function PlatformAuthScreen({
  onAuthed,
}: {
  onAuthed: (u: PlatformUser) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const router = useRouter();
  const [form, setForm] = useState({
    email: "superadmin@danetstecpro.com",
    password: "super123",
    totpCode: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
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
      if (data.code === "PLATFORM_2FA_REQUIRED") {
        throw new Error(
          data.error ||
            "2FA is required for all platform admins. Enable it in Platform Settings → Security before signing in."
        );
      }
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      toast.success("Platform console access granted");
      onAuthed(data.user);
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-slate-950 text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative">
          <DanetsLogo size="lg" variant="full" />
        </div>
        <div className="relative space-y-6 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-sm font-medium text-amber-200">
            <Shield className="h-4 w-4" />
            Platform Console
          </div>
          <h1 className="text-4xl font-bold leading-tight">
            Manage tenants, subscriptions, and platform features.
          </h1>
          <p className="text-white/80 text-lg">
            Internal operators only. All actions are audit-logged. This console
            is separate from the tenant dashboard.
          </p>
        </div>
        <div className="relative text-sm text-white/60">
          © {new Date().getFullYear()} Danets TecPro Limited — Platform
          Administration
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Tenant dashboard
            </Link>
            <h2 className="text-2xl font-bold tracking-tight">
              Platform admin sign in
            </h2>
            <p className="text-sm text-muted-foreground">
              Danets TecPro internal operators — secure, separate auth realm.
            </p>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <Shield className="h-4 w-4 shrink-0" />
            Internal platform access only. All actions are audit-logged.
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field
              icon={<Mail size={16} />}
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="superadmin@danetstecpro.com"
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
            {needsTotp && (
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
              {needsTotp ? "Verify & sign in" : "Platform sign in"}
            </Button>
          </form>

          <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground text-center">
            <span className="font-medium text-foreground">Platform demo:</span>{" "}
            superadmin@danetstecpro.com · super123
          </div>
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
