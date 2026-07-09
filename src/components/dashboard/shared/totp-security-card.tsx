"use client";

import * as React from "react";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type TotpSecurityCardProps = {
  setupPath: string;
  loadStatus: () => Promise<{ totpEnabled: boolean; email: string } | null>;
  disableBlocked?: boolean;
  disableBlockedMessage?: string;
  title?: string;
  description?: string;
};

export function TotpSecurityCard({
  setupPath,
  loadStatus,
  disableBlocked = false,
  disableBlockedMessage = "2FA is required by platform policy and cannot be disabled.",
  title = "Two-factor authentication (TOTP)",
  description = "Protect your account with a 6-digit code from an authenticator app.",
}: TotpSecurityCardProps) {
  const [profile, setProfile] = React.useState<{
    email: string;
    totpEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [setup, setSetup] = React.useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [disablePassword, setDisablePassword] = React.useState("");
  const [disableCode, setDisableCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const status = await loadStatus();
      setProfile(status);
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function beginSetup() {
    setBusy(true);
    try {
      const res = await fetch(setupPath);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed");
      setSetup(data);
      toast.success("Add the secret to your authenticator app");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (!verifyCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(setupPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      toast.success("2FA enabled");
      setSetup(null);
      setVerifyCode("");
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable2fa() {
    setBusy(true);
    try {
      const res = await fetch(setupPath, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: disablePassword,
          code: disableCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("2FA disabled");
      setDisablePassword("");
      setDisableCode("");
      refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant={profile.totpEnabled ? "default" : "secondary"}>
          {profile.totpEnabled ? "On" : "Off"}
        </Badge>
      </div>

      {!profile.totpEnabled && !setup && (
        <Button size="sm" onClick={beginSetup} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Enable 2FA
        </Button>
      )}

      {setup && (
        <div className="rounded-lg border p-3 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Scan in Google Authenticator, Authy, or 1Password:
          </p>
          <code className="block break-all rounded bg-muted px-2 py-1 text-xs font-mono">
            {setup.secret}
          </code>
          <a
            href={setup.otpauthUrl}
            className="text-xs text-primary hover:underline break-all"
          >
            {setup.otpauthUrl}
          </a>
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Verification code</Label>
              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="6-digit code"
                className="h-9"
              />
            </div>
            <Button size="sm" onClick={confirmSetup} disabled={busy}>
              Confirm
            </Button>
          </div>
        </div>
      )}

      {profile.totpEnabled && (
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            2FA is active for <strong>{profile.email}</strong>. You will be
            prompted at sign-in.
          </p>
          {disableBlocked ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {disableBlockedMessage}
            </p>
          ) : (
            <div className="space-y-2">
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Current password"
                className="h-9"
              />
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="Current 2FA code"
                className="h-9"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={disable2fa}
                disabled={busy}
              >
                Disable 2FA
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
