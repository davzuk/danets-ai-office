"use client";

import * as React from "react";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type TenantTwoFactorPolicyProps = {
  businessId: string;
  enforce2fa: boolean;
  /** Called after a successful PATCH so the parent can refresh its cached `BusinessDetail`. */
  onChanged?: () => void;
};

/**
 * Super-admin-only control for the tenant-level 2FA policy. When enabled, every
 * member of the tenant is required to use TOTP at sign-in (the policy is
 * enforced in `src/app/api/auth/login/route.ts` and the tenant-side DELETE on
 * `/api/auth/totp/setup` refuses to clear 2FA while the policy is on).
 */
export function TenantTwoFactorPolicy({
  businessId,
  enforce2fa,
  onChanged,
}: TenantTwoFactorPolicyProps) {
  const [enabled, setEnabled] = React.useState(!!enforce2fa);
  const [busy, setBusy] = React.useState(false);

  // Keep local state in sync if the parent's cached value changes (e.g. after
  // a separate refetch).
  React.useEffect(() => {
    setEnabled(!!enforce2fa);
  }, [enforce2fa]);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/super-admin/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforce2fa: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update policy");
      setEnabled(next);
      toast.success(
        next
          ? "2FA is now required for every member of this tenant."
          : "2FA requirement removed for this tenant."
      );
      onChanged?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update policy");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div>
              <CardTitle className="text-sm">Require 2FA for this tenant</CardTitle>
              <CardDescription className="text-xs">
                Platform operator override. When enabled, every member of this
                organization must complete TOTP setup before they can sign in,
                and they cannot disable 2FA on their own account.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={toggle}
              aria-label="Require 2FA for every member of this tenant"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          {enabled
            ? "Active. Members who have not yet enrolled will be required to set up 2FA on next sign-in."
            : "Inactive. 2FA remains optional for individual members of this tenant."}
        </p>
      </CardContent>
    </Card>
  );
}